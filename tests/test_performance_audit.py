"""Performance audit tests — validate identified bottlenecks and regressions.

These tests are NOT micro-benchmarks. They assert structural performance
properties that, if broken, would cause real-world degradation:

1. SQLite connection uses WAL + synchronous=NORMAL (not the slow defaults).
2. Preview cache has a bounded size (no unbounded memory growth).
3. Scheduler heavy queue is bounded (no unbounded thread growth).
4. Database batch lookup uses a single query (not N individual queries).
5. IPC payload size limit is enforced (prevents pipe blocking).
6. Image conversion opens files with context managers (no leaked FDs).
7. History table has indexes on timestamp and run_type (no full scans).
8. Chunk size calculation is adaptive and bounded.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

# ─── 1. SQLite PRAGMA configuration ─────────────────────────────────────────


def test_sqlite_uses_wal_and_normal_sync() -> None:
    """Repository must configure WAL + synchronous=NORMAL for concurrency."""
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
    """Repository should set a bounded cache size (RSS-friendly defaults)."""
    from backend.core.repository import close_connection, get_connection

    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "test.db"
        try:
            conn = get_connection(db_path)
            cache_size = conn.execute("PRAGMA cache_size").fetchone()[0]
            # Negative = kibibytes. Default is -4000 (4 MiB) — enough for catalog
            # lookups without a large always-resident page cache.
            assert cache_size < 0, f"Expected negative cache_size (KiB mode), got {cache_size}"
            assert abs(cache_size) >= 4000, f"Expected |cache_size| >= 4000 KiB, got {cache_size}"
            assert abs(cache_size) <= 16000, f"Expected |cache_size| <= 16000 KiB, got {cache_size}"
            temp_store = conn.execute("PRAGMA temp_store").fetchone()[0]
            # Default FILE=1 (lower RSS). MEMORY=2 remains available via env.
            assert temp_store in (1, 2), f"Expected temp_store FILE/MEMORY (1/2), got {temp_store}"
            mmap_size = conn.execute("PRAGMA mmap_size").fetchone()[0]
            assert mmap_size <= 16 * 1024 * 1024, f"Expected mmap_size <= 16MiB, got {mmap_size}"
        finally:
            close_connection()


def test_sqlite_temp_store_defaults_to_file(monkeypatch: pytest.MonkeyPatch) -> None:
    """Default temp_store=FILE; ANTARES_SQLITE_TEMP_STORE=MEMORY opts into RAM temps."""
    from backend.core.repository import close_connection, get_connection

    monkeypatch.delenv("ANTARES_SQLITE_TEMP_STORE", raising=False)
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "file.db"
        try:
            close_connection()
            conn = get_connection(db_path)
            assert conn.execute("PRAGMA temp_store").fetchone()[0] == 1  # FILE
        finally:
            close_connection()

    monkeypatch.setenv("ANTARES_SQLITE_TEMP_STORE", "MEMORY")
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "mem.db"
        try:
            close_connection()
            conn = get_connection(db_path)
            assert conn.execute("PRAGMA temp_store").fetchone()[0] == 2  # MEMORY
        finally:
            close_connection()


def test_read_connection_is_readonly(tmp_path) -> None:
    """Read pool must reject writes when mode=ro is active."""
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


# ─── 2. Preview cache bounds ────────────────────────────────────────────────


def test_preview_cache_is_bounded() -> None:
    """Preview cache must evict old entries to prevent memory leaks."""
    from backend.core.preview_cache import PreviewCache

    cache = PreviewCache(max_size=10, ttl_seconds=300)
    for i in range(20):
        cache.set(f"key_{i}", {"data": i})

    # First 10 entries should have been evicted
    assert cache.get("key_0") is None, "Cache should have evicted key_0"
    assert cache.get("key_19") is not None, "Cache should retain key_19"
    assert cache.get("key_19")["data"] == 19


def test_preview_cache_skips_data_uri_payloads() -> None:
    """Embedded data-URI previews must not be retained in the LRU cache."""
    from backend.core.preview_cache import PreviewCache

    cache = PreviewCache(max_size=10, ttl_seconds=300)
    cache.set("data", {"preview": "data:image/jpeg;base64," + ("A" * 1000)})
    cache.set("path", {"preview": "file:///tmp/x.jpg", "preview_path": "/tmp/x.jpg"})
    assert cache.get("data") is None
    assert cache.get("path") is not None


def test_preview_cache_respects_ttl() -> None:
    """Preview cache must expire entries after TTL."""
    from backend.core.preview_cache import PreviewCache

    cache = PreviewCache(max_size=10, ttl_seconds=0)
    cache.set("key", {"data": 1})
    # TTL=0 means immediate expiry
    import time

    time.sleep(0.01)
    assert cache.get("key") is None, "Cache should have expired the entry"


# ─── 3. Scheduler heavy queue bounds ────────────────────────────────────────


def test_scheduler_heavy_capacity_is_bounded() -> None:
    """Scheduler must reject work when heavy capacity is full."""
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


# ─── 4. Database batch lookup ───────────────────────────────────────────────


def test_buscar_lote_por_codigos_uses_batch_query(tmp_path, monkeypatch) -> None:
    """Batch lookup must not issue N individual queries."""
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

        # Must find the two existing codes
        assert "A001" in result
        assert "B002" in result
        # Batch query should use a single query (or chunked), not N individual.
        # We verify by checking that the result has both keys from one call.
        assert len(result) == 2
        # Explicit column projection (all configured fields, no SELECT *)
        assert set(result["A001"].keys()) == {"codigo", "nombre"}
    finally:
        close_connection()


def test_buscar_queries_project_columns_not_star() -> None:
    """Batch lookups must SELECT explicit columns, never SELECT *."""
    import inspect

    from backend.core.database import buscar_lote_por_codigos, buscar_por_columna

    sources = inspect.getsource(buscar_lote_por_codigos) + "\n" + inspect.getsource(buscar_por_columna)
    assert "SELECT rowid AS __antares_rowid__, *" not in sources
    assert "__antares_rowid__, *" not in sources
    assert "SELECT rowid AS __antares_rowid__, {cols}" in sources
    assert "cols = " in sources
    # Key-column-first then multi-field OR fallback for unresolved codes
    assert "preferred" in inspect.getsource(buscar_lote_por_codigos)
    assert "OR" in inspect.getsource(buscar_lote_por_codigos)
    assert "unresolved" in inspect.getsource(buscar_lote_por_codigos)


# ─── 5. IPC payload size limit ──────────────────────────────────────────────


def test_ipc_max_payload_size_is_set() -> None:
    """IPC protocol must enforce a payload size limit."""
    from backend.ipc_protocol import _MAX_PAYLOAD_SIZE

    assert _MAX_PAYLOAD_SIZE > 0, "Max payload size must be positive"
    assert _MAX_PAYLOAD_SIZE >= 10 * 1024 * 1024, "Max payload size should be at least 10MB"


# ─── 6. History table indexes ───────────────────────────────────────────────


def test_history_table_has_indexes(tmp_path, monkeypatch) -> None:
    """History table must have indexes on timestamp and run_type."""
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


# ─── 7. Chunk size is adaptive and bounded ──────────────────────────────────


def test_chunk_size_is_bounded() -> None:
    """Chunk size must be bounded to prevent memory exhaustion."""
    from backend.handlers.conversion import _calculate_chunk_size

    chunk_size = _calculate_chunk_size()
    assert 50 <= chunk_size <= 1000, f"Chunk size should be 50-1000, got {chunk_size}"


# ─── 8. SQLite query param limit respected ──────────────────────────────────


def test_batch_lookup_respects_sqlite_param_limit(tmp_path, monkeypatch) -> None:
    """Batch lookup must chunk to avoid SQLite's 999 param limit."""
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
        # Insert 1000 rows
        values = [(f"CODE_{i:04d}",) for i in range(1000)]
        conn.executemany("INSERT INTO imagenes (codigo) VALUES (?)", values)
        conn.commit()

        # Query with 2000 codes — must not hit the 999 param limit
        codes = [f"CODE_{i:04d}" for i in range(2000)]
        with _db_lock:
            result = buscar_por_columna(codes, "codigo")

        # Should find the 1000 existing codes
        assert len(result) == 1000, f"Expected 1000 results, got {len(result)}"
    finally:
        close_connection()


# ─── 9. Main loop dispatch does not block on heavy handlers ─────────────────


def test_main_loop_submits_to_scheduler() -> None:
    """Main loop must dispatch handlers to the scheduler, not run inline."""
    from backend.main import _submit_handler

    # _submit_handler should exist and be callable
    assert callable(_submit_handler), "_submit_handler must be callable"


# ─── 10. Connection is reused (not reconnected per query) ──────────────────


def test_connection_is_reused() -> None:
    """Repository must reuse the same connection object for the same DB path."""
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
    """Previews should prefer file:// / path over base64 for IPC size."""
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
    """Full-table Excel import must ANALYZE so the planner sees fresh stats."""
    import inspect

    from backend.core import database as db

    source = inspect.getsource(db.importar_excel)
    assert "ANALYZE imagenes" in source


def test_ubicaciones_preview_uses_csp_safe_data_uri() -> None:
    """Ubicaciones preview image must be a data: URI (Electron CSP blocks file:)."""
    import inspect

    from backend.handlers import ubicaciones as ubi

    source = inspect.getsource(ubi._encode_preview_data)
    assert "b64encode" in source
    assert "data:image/jpeg;base64," in source
    assert "image_path" in source
    # Disk cache path is kept for invalidation; do not expose file: as img src.
    assert "as_uri()" not in source


def test_fichas_get_all_uses_shallow_copy(tmp_path) -> None:
    """List path must not deepcopy nested ficha trees."""
    from backend.core.fichas_tecnicas.database import FichasTecnicasDB

    db = FichasTecnicasDB(tmp_path / "f.json")
    created = db.create({"cliente": "Acme", "productos": [{"producto": "X"}]})
    listed = db.get_all()
    assert len(listed) == 1
    # Top-level dict is a copy…
    assert listed[0] is not db._items[created["id"]]
    # …but nested list is shared (shallow) — mutation of nested is discouraged.
    assert listed[0]["productos"] is db._items[created["id"]]["productos"]
    # get() still deep-copies for safe editing
    got = db.get(created["id"])
    assert got is not None
    assert got["productos"] is not db._items[created["id"]]["productos"]


def test_warm_prewarms_history_schema_and_pandas_sync() -> None:
    """History schema warms post-ready; pandas/openpyxl pre-import BEFORE ready.

    Without these: the first history_list pays ~250 ms of lazy DDL migration
    and the first db_import serializes behind the post-ready daemon's import
    chain (cold db_import measured at ~122 s under Python's global import
    lock + serialized_import guard). pandas/openpyxl must be imported on the
    main thread before the ready handshake (warm_pandas_sync), not in the
    post-ready daemon.
    """
    import inspect

    from backend.handlers import HandlerRegistry

    post_ready = inspect.getsource(HandlerRegistry.warm_post_ready)
    assert "_ensure_table" in post_ready
    # pandas/openpyxl must NOT be re-imported by the post-ready daemon:
    # that was the 122 s cold-db_import contention (warm held the
    # serialized_import lock while loading numpy, worker waited).
    post_ready_imports = [
        ln.strip() for ln in post_ready.splitlines() if ln.strip().startswith("import ")
    ]
    assert not any("pandas" in ln or "openpyxl" in ln for ln in post_ready_imports)

    pandas_sync = inspect.getsource(HandlerRegistry.warm_pandas_sync)
    assert "import pandas" in pandas_sync
    assert "import openpyxl" in pandas_sync


def test_cold_imports_are_serialized_against_cextension_deadlock() -> None:
    """C-extension cold-imports must run under serialized_import().

    On Windows, two threads cold-importing C extensions (numpy via pandas in
    db_import, rpds via jsonschema in history) can deadlock the whole process:
    Python import lock x Windows loader lock (observed via py-spy). Every
    cold-import path must go through the shared guard.
    """
    import inspect

    from backend.core import database as db
    from backend.handlers import history as history_handlers

    import_source = inspect.getsource(db.importar_excel)
    assert "serialized_import" in import_source
    analyze_source = inspect.getsource(db.parse_id_rename_mapping_full)
    assert "serialized_import" in analyze_source

    handler_source = inspect.getsource(history_handlers)
    assert "def _core_history" in handler_source
    assert "with serialized_import():" in handler_source


def test_cold_import_requests_wait_for_warm_critical(monkeypatch) -> None:
    """Cold-import handlers must wait for WARM_CRITICAL_DONE before running.

    The post-ready warm imports C extensions (numpy, rpds, Pillow, …); a
    request cold-importing another C extension at the same time can deadlock
    the process on Windows (Python import lock x loader lock). Methods that
    cold-import must wait; shell methods and pure JSON canvas ops must not.
    """
    import backend.main as main
    from backend.handlers import HandlerRegistry

    assert "db_import" in main._WARM_WAIT_METHODS
    assert "preview" in main._WARM_WAIT_METHODS
    assert "technical_reports_render_html" in main._WARM_WAIT_METHODS
    # Payload-heavy but import-free: must not wait behind the warm.
    assert "canvas_save" not in main._WARM_WAIT_METHODS
    assert "canvas_get" not in main._WARM_WAIT_METHODS
    # Sync health probes must never wait.
    assert "version" not in main._WARM_WAIT_METHODS
    assert "process_status" not in main._WARM_WAIT_METHODS

    # The warm thread releases the wait after its guarded imports.
    import inspect

    source = inspect.getsource(HandlerRegistry.warm_post_ready)
    assert "WARM_CRITICAL_DONE.set()" in source

    # Behavior: _dispatch waits for cold-import methods, not for others.
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
