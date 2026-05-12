"""Shared persistence layer: SQLite connection pool and repository base."""
from __future__ import annotations

import contextlib
import logging
import sqlite3
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_db_lock = threading.RLock()
_db_conn: sqlite3.Connection | None = None
_db_conn_path: str | None = None


def get_connection(db_path: Path) -> sqlite3.Connection:
    """Return a persistent WAL-mode connection (thread-safe via lock).

    Reconnects if db_path changes (e.g. during tests).
    """
    global _db_conn, _db_conn_path
    with _db_lock:
        current_path = str(db_path)
        if _db_conn is None or _db_conn_path != current_path:
            if _db_conn is not None:
                with contextlib.suppress(Exception):
                    _db_conn.close()
            db_path.parent.mkdir(parents=True, exist_ok=True)
            _db_conn = sqlite3.connect(current_path, check_same_thread=False, isolation_level=None)
            _db_conn.execute("PRAGMA journal_mode=WAL")
            _db_conn.execute("PRAGMA synchronous=NORMAL")
            _db_conn.execute("PRAGMA cache_size=-64000")
            _db_conn.execute("PRAGMA temp_store=MEMORY")
            _db_conn.execute("PRAGMA mmap_size=268435456")
            _db_conn.execute("PRAGMA page_size=4096")
            _db_conn.row_factory = sqlite3.Row
            _db_conn_path = current_path
        return _db_conn


def close_connection() -> None:
    """Close the pooled connection (call on shutdown)."""
    global _db_conn, _db_conn_path
    with _db_lock:
        if _db_conn is not None:
            _db_conn.close()
            _db_conn = None
            _db_conn_path = None


def execute_query(db_path: Path, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    """Execute a SELECT query and return rows as dicts."""
    with _db_lock:
        conn = get_connection(db_path)
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def execute_write(db_path: Path, sql: str, params: tuple = ()) -> int:
    """Execute a write query and return lastrowid or rowcount."""
    with _db_lock:
        conn = get_connection(db_path)
        cursor = conn.execute(sql, params)
        conn.commit()
        return cursor.lastrowid or cursor.rowcount
