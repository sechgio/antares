
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


def test_get_all_does_not_renormalize_stored_items(tmp_path) -> None:
    from backend.core.json_store import JsonDocumentStore

    calls = 0

    def counting(item):
        nonlocal calls
        calls += 1
        return dict(item)

    store = JsonDocumentStore(tmp_path / "s.json", counting)
    store.insert({"id": "a", "title": "x"})
    calls = 0
    store.get_all()
    store.get("a")
    assert calls == 0


def test_warm_prewarms_history_schema_without_pandas_sync() -> None:
    import inspect

    import backend.main as backend_main
    from backend.handlers import HandlerRegistry

    post_ready = inspect.getsource(HandlerRegistry.warm_post_ready)
    assert "_ensure_table" in post_ready
    post_ready_imports = [
        ln.strip() for ln in post_ready.splitlines() if ln.strip().startswith("import ")
    ]
    assert not any("pandas" in ln or "openpyxl" in ln for ln in post_ready_imports)

    # Regresión: el warm post-ready de pandas/openpyxl retenía serialized_import
    # durante ~45-120 s y bloqueaba la carga lazy de handlers (C1 del audit).
    assert not hasattr(HandlerRegistry, "warm_pandas_sync")
    assert "warm_pandas" not in inspect.getsource(backend_main)

    # Regresión: el warm post-ready de weasyprint retenía serialized_import
    # durante el import frío (>90 s medidos en máquina degradada) y bloqueaba
    # _load_module con el mismo mecanismo que C1.
    assert "write_pdf_sanitized" not in post_ready
    assert "pdf_html" not in post_ready


def test_cold_imports_are_serialized_against_cextension_deadlock() -> None:
    import inspect

    from backend.core import database as db
    from backend.handlers import history as history_handlers
    from backend.utils import pdf_html

    import_source = inspect.getsource(db.importar_excel)
    assert "serialized_import" in import_source
    assert "load_workbook" in import_source
    assert "import pandas" not in import_source
    export_source = inspect.getsource(db.exportar_excel)
    assert "serialized_import" in export_source
    assert "import pandas" in export_source
    analyze_source = inspect.getsource(db.parse_id_rename_mapping_full)
    assert "serialized_import" in analyze_source
    pdf_source = inspect.getsource(pdf_html.write_pdf_sanitized)
    assert "serialized_import" in pdf_source
    assert "from weasyprint import HTML" in pdf_source

    from backend.core.panel_aviso_corte.importer import parse_excel_bytes
    importer_source = inspect.getsource(parse_excel_bytes)
    assert "serialized_import" in importer_source
    assert "import openpyxl" in importer_source

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


def test_json_document_store_uses_compact_serialization(tmp_path) -> None:
    from backend.core.json_store import JsonDocumentStore

    db_path = tmp_path / "store.json"
    store = JsonDocumentStore(db_path, lambda d: d)
    store._items = {
        "1": {"id": "1", "title": "Doc 1", "data": [1, 2, 3]},
        "2": {"id": "2", "title": "Doc 2", "data": [4, 5, 6]},
    }
    store._save(store._items)

    raw_text = db_path.read_text(encoding="utf-8")
    assert "\n" not in raw_text
    assert ": " not in raw_text
    assert ", " not in raw_text
    assert '{"1":{"id":"1"' in raw_text or '{"2":{"id":"2"' in raw_text


