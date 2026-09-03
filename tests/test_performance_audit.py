
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest


def test_sqlite_uses_wal_and_normal_sync() -> None:
    from backend.core.repository import close_connection, get_connection

    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "test.db"
        try:
            conn = get_connection(db_path)
            journal_mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
            synchronous = conn.execute("PRAGMA synchronous").fetchone()[0]
            assert journal_mode.lower() == "wal", f"Expected WAL, got {journal_mode}"
            assert synchronous == 1, f"Expected synchronous=NORMAL (1), got {synchronous}"
        finally:
            close_connection()


def test_sqlite_cache_size_is_set() -> None:
    from backend.core.repository import close_connection, get_connection

    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "test.db"
        try:
            conn = get_connection(db_path)
            cache_size = conn.execute("PRAGMA cache_size").fetchone()[0]
            assert cache_size < 0, f"Expected negative cache_size (KiB mode), got {cache_size}"
            assert abs(cache_size) >= 4000, f"Expected |cache_size| >= 4000 KiB, got {cache_size}"
            assert abs(cache_size) <= 16000, f"Expected |cache_size| <= 16000 KiB, got {cache_size}"
            temp_store = conn.execute("PRAGMA temp_store").fetchone()[0]
            assert temp_store in (1, 2), f"Expected temp_store FILE/MEMORY (1/2), got {temp_store}"
            mmap_size = conn.execute("PRAGMA mmap_size").fetchone()[0]
            assert mmap_size <= 16 * 1024 * 1024, f"Expected mmap_size <= 16MiB, got {mmap_size}"
        finally:
            close_connection()


def test_sqlite_temp_store_defaults_to_file(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.core.repository import close_connection, get_connection

    monkeypatch.delenv("ANTARES_SQLITE_TEMP_STORE", raising=False)
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "file.db"
        try:
            close_connection()
            conn = get_connection(db_path)
            assert conn.execute("PRAGMA temp_store").fetchone()[0] == 1
        finally:
            close_connection()

    monkeypatch.setenv("ANTARES_SQLITE_TEMP_STORE", "MEMORY")
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "mem.db"
        try:
            close_connection()
            conn = get_connection(db_path)
            assert conn.execute("PRAGMA temp_store").fetchone()[0] == 2
        finally:
            close_connection()


def test_read_connection_is_readonly(tmp_path) -> None:
    from backend.core.repository import close_connection, get_connection, get_read_connection

    db_path = tmp_path / "ro.db"
    try:
        write = get_connection(db_path)
        write.execute("CREATE TABLE t (id INTEGER)")
        write.execute("INSERT INTO t (id) VALUES (1)")
        write.commit()

        read = get_read_connection(db_path)
        row = read.execute("SELECT id FROM t").fetchone()
        assert row[0] == 1
        import sqlite3

        try:
            read.execute("INSERT INTO t (id) VALUES (2)")
            raise AssertionError("read connection allowed INSERT")
        except sqlite3.OperationalError as exc:
            assert "readonly" in str(exc).lower() or "read-only" in str(exc).lower()
    finally:
        close_connection()


def test_preview_cache_is_bounded() -> None:
    from backend.core.preview_cache import PreviewCache

    cache = PreviewCache(max_size=10, ttl_seconds=300)
    for i in range(20):
        cache.set(f"key_{i}", {"data": i})

    assert cache.get("key_0") is None, "Cache should have evicted key_0"
    assert cache.get("key_19") is not None, "Cache should retain key_19"
    assert cache.get("key_19")["data"] == 19


def test_preview_cache_skips_data_uri_payloads() -> None:
    from backend.core.preview_cache import PreviewCache

    cache = PreviewCache(max_size=10, ttl_seconds=300)
    cache.set("data", {"preview": "data:image/jpeg;base64," + ("A" * 1000)})
    cache.set("path", {"preview": "file:///tmp/x.jpg", "preview_path": "/tmp/x.jpg"})
    assert cache.get("data") is None
    assert cache.get("path") is not None


def test_preview_cache_respects_ttl() -> None:
    from backend.core.preview_cache import PreviewCache

    cache = PreviewCache(max_size=10, ttl_seconds=0)
    cache.set("key", {"data": 1})
    import time

    time.sleep(0.01)
    assert cache.get("key") is None, "Cache should have expired the entry"


def test_scheduler_heavy_capacity_is_bounded() -> None:
    import threading

    from backend.core.scheduler import SchedulerBusy, WorkScheduler

    release = threading.Event()
    scheduler = WorkScheduler(light_workers=1, heavy_workers=1, heavy_queue_limit=0)
    try:
        scheduler.submit_heavy(release.wait)
        with pytest.raises(SchedulerBusy):
            scheduler.submit_heavy(release.wait)
        metrics = scheduler.metrics()
        assert metrics["heavy_capacity"] == 1
        assert metrics["heavy_rejected"] == 1
    finally:
        release.set()
        scheduler.shutdown(wait=True)


def test_buscar_lote_por_codigos_uses_batch_query(tmp_path, monkeypatch) -> None:
    from backend.core import database as db
    from backend.core.config_fields import save_fields
    from backend.core.database import buscar_lote_por_codigos
    from backend.core.repository import _db_lock, close_connection, get_connection

    db_file = tmp_path / "test_audit.db"
    monkeypatch.setattr(db, "get_db_path", lambda: db_file)
    monkeypatch.setattr(
        "backend.core.config_fields._config_file",
        lambda: tmp_path / "fields_config.json",
    )
    save_fields([
        {"name": "codigo", "type": "TEXT", "required": True, "unique": True},
        {"name": "nombre", "type": "TEXT"},
    ])
    db.init_db()

    try:
        conn = get_connection(db_file)
        conn.execute("INSERT INTO imagenes (codigo, nombre) VALUES ('A001', 'Alpha')")
        conn.execute("INSERT INTO imagenes (codigo, nombre) VALUES ('B002', 'Beta')")
        conn.commit()

        with _db_lock:
            result = buscar_lote_por_codigos(["A001", "B002", "C003"])

        assert "A001" in result
        assert "B002" in result
        assert len(result) == 2
        assert set(result["A001"].keys()) == {"codigo", "nombre"}
    finally:
        close_connection()


def test_buscar_queries_project_columns_not_star() -> None:
    import inspect

    from backend.core.database import buscar_lote_por_codigos, buscar_por_columna

    sources = inspect.getsource(buscar_lote_por_codigos) + "\n" + inspect.getsource(buscar_por_columna)
    assert "SELECT rowid AS __antares_rowid__, *" not in sources
    assert "__antares_rowid__, *" not in sources
    assert "SELECT rowid AS __antares_rowid__, {cols}" in sources
    assert "cols = " in sources
    assert "preferred" in inspect.getsource(buscar_lote_por_codigos)
    assert "OR" in inspect.getsource(buscar_lote_por_codigos)
    assert "unresolved" in inspect.getsource(buscar_lote_por_codigos)


def test_ipc_max_payload_size_is_set() -> None:
    from backend.ipc_protocol import _MAX_PAYLOAD_SIZE

    assert _MAX_PAYLOAD_SIZE > 0, "Max payload size must be positive"
    assert _MAX_PAYLOAD_SIZE >= 10 * 1024 * 1024, "Max payload size should be at least 10MB"


def test_history_table_has_indexes(tmp_path, monkeypatch) -> None:
    from backend.core import database as db
    from backend.core import history
    from backend.core.config_fields import save_fields
    from backend.core.history import _ensure_table
    from backend.core.repository import close_connection, get_connection

    db_file = tmp_path / "test_audit.db"
    monkeypatch.setattr(db, "get_db_path", lambda: db_file)
    monkeypatch.setattr(history, "get_db_path", lambda: db_file)
    monkeypatch.setattr(
        "backend.core.config_fields._config_file",
        lambda: tmp_path / "fields_config.json",
    )
    save_fields([
        {"name": "codigo", "type": "TEXT", "required": True, "unique": True},
        {"name": "nombre", "type": "TEXT"},
    ])
    db.init_db()

    try:
        _ensure_table()
        conn = get_connection(db_file)
        indexes = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='historial'"
        ).fetchall()
        index_names = {row[0] for row in indexes}
        assert "idx_historial_ts" in index_names, f"Missing idx_historial_ts index. Found: {index_names}"
        assert "idx_historial_run_type" in index_names, f"Missing idx_historial_run_type index. Found: {index_names}"
    finally:
        close_connection()


def test_chunk_size_is_bounded() -> None:
    from backend.handlers.conversion import _calculate_chunk_size

    chunk_size = _calculate_chunk_size()
    assert 50 <= chunk_size <= 1000, f"Chunk size should be 50-1000, got {chunk_size}"


def test_batch_lookup_respects_sqlite_param_limit(tmp_path, monkeypatch) -> None:
    from backend.core import database as db
    from backend.core.config_fields import save_fields
    from backend.core.database import buscar_por_columna
    from backend.core.repository import _db_lock, close_connection, get_connection

    db_file = tmp_path / "test_audit.db"
    monkeypatch.setattr(db, "get_db_path", lambda: db_file)
    monkeypatch.setattr(
        "backend.core.config_fields._config_file",
        lambda: tmp_path / "fields_config.json",
    )
    save_fields([
        {"name": "codigo", "type": "TEXT", "required": True, "unique": True},
        {"name": "nombre", "type": "TEXT"},
    ])
    db.init_db()

    try:
        conn = get_connection(db_file)
        values = [(f"CODE_{i:04d}",) for i in range(1000)]
        conn.executemany("INSERT INTO imagenes (codigo) VALUES (?)", values)
        conn.commit()

        codes = [f"CODE_{i:04d}" for i in range(2000)]
        with _db_lock:
            result = buscar_por_columna(codes, "codigo")

        assert len(result) == 1000, f"Expected 1000 results, got {len(result)}"
    finally:
        close_connection()


def test_main_loop_submits_to_scheduler() -> None:
    from backend.main import _submit_handler

    assert callable(_submit_handler), "_submit_handler must be callable"


def test_connection_is_reused() -> None:
    from backend.core.repository import close_connection, get_connection

    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "test.db"
        try:
            conn1 = get_connection(db_path)
            conn2 = get_connection(db_path)
            assert conn1 is conn2, "Connection should be reused for the same DB path"
        finally:
            close_connection()


def test_convertir_a_preview_defaults_to_file_path(tmp_path) -> None:
    from PIL import Image

    from backend.core.converter import convertir_a_preview
    from backend.core.preview_cache import get_preview_cache

    get_preview_cache().clear()
    origen = tmp_path / "p.png"
    Image.new("RGB", (120, 80), color=(9, 9, 9)).save(origen)
    result = convertir_a_preview(origen, "JPEG")
    assert result["preview"].startswith("file:")
    assert Path(result["preview_path"]).is_file()
    assert "base64," not in result["preview"]


def test_importar_excel_runs_analyze(tmp_path, monkeypatch) -> None:
    import inspect

    from backend.core import database as db

    source = inspect.getsource(db.importar_excel)
    assert "ANALYZE imagenes" in source


def test_ubicaciones_preview_uses_csp_safe_data_uri() -> None:
    import inspect

    from backend.handlers import ubicaciones as ubi

    source = inspect.getsource(ubi._encode_preview_data)
    assert "b64encode" in source
    assert "data:image/jpeg;base64," in source
    assert "image_path" in source
    assert "as_uri()" not in source


def test_fichas_get_all_uses_shallow_copy(tmp_path) -> None:
    from backend.core.fichas_tecnicas.database import FichasTecnicasDB

    db = FichasTecnicasDB(tmp_path / "f.json")
    created = db.create({"cliente": "Acme", "productos": [{"producto": "X"}]})
    listed = db.get_all()
    assert len(listed) == 1
    assert listed[0] is not db._items[created["id"]]
    assert listed[0]["productos"] is db._items[created["id"]]["productos"]
    got = db.get(created["id"])
    assert got is not None
    assert got["productos"] is not db._items[created["id"]]["productos"]


def test_warm_prewarms_history_schema_and_pandas_sync() -> None:
    import inspect

    from backend.handlers import HandlerRegistry

    post_ready = inspect.getsource(HandlerRegistry.warm_post_ready)
    assert "_ensure_table" in post_ready
    post_ready_imports = [
        ln.strip() for ln in post_ready.splitlines() if ln.strip().startswith("import ")
    ]
    assert not any("pandas" in ln or "openpyxl" in ln for ln in post_ready_imports)

    pandas_sync = inspect.getsource(HandlerRegistry.warm_pandas_sync)
    assert "import pandas" in pandas_sync
    assert "import openpyxl" in pandas_sync


def test_cold_imports_are_serialized_against_cextension_deadlock() -> None:
    import inspect

    from backend.core import database as db
    from backend.handlers import history as history_handlers

    import_source = inspect.getsource(db.importar_excel)
    assert "serialized_import" in import_source
    assert "load_workbook" in import_source
    assert "import pandas" not in import_source
    analyze_source = inspect.getsource(db.parse_id_rename_mapping_full)
    assert "serialized_import" in analyze_source

    handler_source = inspect.getsource(history_handlers)
    assert "def _core_history" in handler_source
    assert "with serialized_import():" in handler_source


def test_cold_import_requests_wait_for_warm_critical(monkeypatch) -> None:
    import backend.main as main
    from backend.handlers import HandlerRegistry

    assert "db_import" in main._WARM_WAIT_METHODS
    assert "preview" in main._WARM_WAIT_METHODS
    assert "technical_reports_render_html" in main._WARM_WAIT_METHODS
    assert "canvas_save" not in main._WARM_WAIT_METHODS
    assert "canvas_get" not in main._WARM_WAIT_METHODS
    assert "version" not in main._WARM_WAIT_METHODS
    assert "process_status" not in main._WARM_WAIT_METHODS

    import inspect

    source = inspect.getsource(HandlerRegistry.warm_post_ready)
    assert "WARM_CRITICAL_DONE.set()" in source

    waited: list[float | None] = []

    class FakeEvent:
        def wait(self, timeout: float | None = None) -> bool:
            waited.append(timeout)
            return True

    monkeypatch.setattr(main, "WARM_CRITICAL_DONE", FakeEvent())
    responses: list[tuple] = []
    monkeypatch.setattr(
        main,
        "send_response",
        lambda result, msg_id, **kw: responses.append((result, msg_id)),
    )

    main._dispatch(lambda _p: {"ok": True}, {}, "w1", "db_import")
    assert len(waited) == 1, "db_import must wait for the warm"
    main._dispatch(lambda _p: {"ok": True}, {}, "w2", "version")
    assert len(waited) == 1, "version must not wait for the warm"
    main._dispatch(lambda _p: {"ok": True}, {}, "w3", "canvas_save")
    assert len(waited) == 1, "canvas_save must not wait for the warm"
    assert len(responses) == 3


def test_convertir_a_preview_accelerates_jpeg_with_draft(tmp_path) -> None:
    from PIL import Image

    from backend.core.converter import convertir_a_preview

    img_path = tmp_path / "large_photo.jpg"
    img = Image.new("RGB", (2000, 1500), color=(120, 80, 200))
    img.save(img_path, "JPEG")

    result = convertir_a_preview(img_path, "PNG", as_data_uri=False)
    assert result["width"] == "2000"
    assert result["height"] == "1500"
    assert Path(result["preview_path"]).exists()

    with Image.open(result["preview_path"]) as preview_img:
        assert max(preview_img.size) <= 400
        assert preview_img.size == (400, 300)


def test_conversion_task_queue_uses_deque() -> None:
    import inspect

    from backend.handlers import conversion

    source = inspect.getsource(conversion._run_conversion_job)
    assert "task_queue = deque(chunk_tasks)" in source
    assert "task = _task_queue.popleft()" in source
    assert "pop(0)" not in source


def test_json_document_store_uses_compact_serialization(tmp_path) -> None:
    from backend.core.json_store import JsonDocumentStore

    db_path = tmp_path / "store.json"
    store = JsonDocumentStore(db_path, lambda d: d)
    store._items = {
        "1": {"id": "1", "title": "Doc 1", "data": [1, 2, 3]},
        "2": {"id": "2", "title": "Doc 2", "data": [4, 5, 6]},
    }
    store._save()

    raw_text = db_path.read_text(encoding="utf-8")
    assert "\n" not in raw_text
    assert ": " not in raw_text
    assert ", " not in raw_text
    assert '{"1":{"id":"1"' in raw_text or '{"2":{"id":"2"' in raw_text


