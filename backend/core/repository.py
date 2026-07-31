"""Shared persistence layer: SQLite connection pool and repository base."""
from __future__ import annotations

import contextlib
import logging
import sqlite3
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

_db_lock = threading.RLock()
_db_conn: sqlite3.Connection | None = None
_db_conn_path: str | None = None
_db_read_conn: sqlite3.Connection | None = None
_db_read_conn_path: str | None = None


def _apply_pragmas(conn: sqlite3.Connection) -> None:
    """Shared performance pragmas for write and read pools.

    temp_store=MEMORY speeds sorts/hashes for large IN lookups; on very low-RAM
    machines this trades disk spill for a larger peak memory footprint alongside
    the 16MB page cache.
    """
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=-16000")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA mmap_size=67108864")
    conn.execute("PRAGMA page_size=4096")
    conn.row_factory = sqlite3.Row


def get_connection(db_path: Path) -> sqlite3.Connection:
    """Return a persistent WAL-mode connection (thread-safe via lock).

    Reconnects if db_path changes (e.g. during tests).
    """
    global _db_conn, _db_conn_path, _db_read_conn, _db_read_conn_path
    with _db_lock:
        current_path = str(db_path)
        if _db_conn is None or _db_conn_path != current_path:
            if _db_conn is not None:
                with contextlib.suppress(Exception):
                    _db_conn.close()
            # Path change invalidates the read pool too (same file, two handles).
            if _db_read_conn is not None:
                with contextlib.suppress(Exception):
                    _db_read_conn.close()
                _db_read_conn = None
                _db_read_conn_path = None
            db_path.parent.mkdir(parents=True, exist_ok=True)
            _db_conn = sqlite3.connect(current_path, check_same_thread=False, isolation_level=None)
            _apply_pragmas(_db_conn)
            _db_conn_path = current_path
        return _db_conn


def get_read_connection(db_path: Path) -> sqlite3.Connection:
    """Return a pooled read-only connection for SELECT paths.

    Falls back to the write connection when the DB file does not exist yet
    (mode=ro cannot create the file). Callers must still hold ``_db_lock`` while
    using the returned connection (sqlite3.Connection is not thread-safe).
    """
    global _db_read_conn, _db_read_conn_path
    if not db_path.exists():
        return get_connection(db_path)

    with _db_lock:
        current_path = str(db_path)
        if _db_read_conn is None or _db_read_conn_path != current_path:
            if _db_read_conn is not None:
                with contextlib.suppress(Exception):
                    _db_read_conn.close()
            uri = db_path.resolve().as_uri()
            uri = f"{uri}?mode=ro" if "?" not in uri else f"{uri}&mode=ro"
            try:
                _db_read_conn = sqlite3.connect(
                    uri,
                    uri=True,
                    check_same_thread=False,
                    isolation_level=None,
                )
                _apply_pragmas(_db_read_conn)
                _db_read_conn_path = current_path
            except sqlite3.Error:
                logger.debug("Read-only connect failed; falling back to write pool", exc_info=True)
                return get_connection(db_path)
        return _db_read_conn


def close_connection() -> None:
    """Close the pooled write and read connections (call on shutdown)."""
    global _db_conn, _db_conn_path, _db_read_conn, _db_read_conn_path
    with _db_lock:
        if _db_conn is not None:
            _db_conn.close()
            _db_conn = None
            _db_conn_path = None
        if _db_read_conn is not None:
            with contextlib.suppress(Exception):
                _db_read_conn.close()
            _db_read_conn = None
            _db_read_conn_path = None
