from __future__ import annotations

import contextlib
import logging
import os
import sqlite3
import threading
from pathlib import Path

logger = logging.getLogger(__name__)


class _ReadWriteLock:

    def __init__(self) -> None:
        self._condition = threading.Condition(threading.RLock())
        self._readers = 0
        self._reader_counts: dict[int, int] = {}
        self._writer_thread: int | None = None
        self._writer_depth = 0
        self._waiting_writers = 0

    @contextlib.contextmanager
    def read(self):
        thread_id = threading.get_ident()
        reentrant_writer = False
        with self._condition:
            if self._writer_thread == thread_id:
                reentrant_writer = True
            elif self._reader_counts.get(thread_id, 0):
                self._readers += 1
                self._reader_counts[thread_id] += 1
            else:
                while self._writer_thread is not None or self._waiting_writers:
                    self._condition.wait()
                self._readers += 1
                self._reader_counts[thread_id] = self._reader_counts.get(thread_id, 0) + 1
        try:
            yield
        finally:
            if not reentrant_writer:
                with self._condition:
                    count = self._reader_counts.get(thread_id, 0)
                    if count <= 1:
                        self._reader_counts.pop(thread_id, None)
                    else:
                        self._reader_counts[thread_id] = count - 1
                    self._readers -= 1
                    if self._readers == 0:
                        self._condition.notify_all()

    @contextlib.contextmanager
    def write(self):
        thread_id = threading.get_ident()
        with self._condition:
            if self._writer_thread == thread_id:
                self._writer_depth += 1
            else:
                self._waiting_writers += 1
                try:
                    while self._writer_thread is not None or self._readers:
                        self._condition.wait()
                    self._writer_thread = thread_id
                    self._writer_depth = 1
                finally:
                    self._waiting_writers -= 1
        try:
            yield
        finally:
            with self._condition:
                if self._writer_thread == thread_id:
                    self._writer_depth -= 1
                    if self._writer_depth == 0:
                        self._writer_thread = None
                        self._condition.notify_all()


_db_schema_lock = _ReadWriteLock()
_db_lock = threading.RLock()
_db_read_lock = threading.RLock()
_db_conn: sqlite3.Connection | None = None
_db_conn_path: str | None = None
_db_read_conn: sqlite3.Connection | None = None
_db_read_conn_path: str | None = None


def _apply_pragmas(conn: sqlite3.Connection) -> None:
    temp_store = os.environ.get("ANTARES_SQLITE_TEMP_STORE", "FILE").strip().upper()
    if temp_store not in {"FILE", "MEMORY"}:
        temp_store = "FILE"

    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=-4000")
    conn.execute(f"PRAGMA temp_store={temp_store}")
    conn.execute("PRAGMA mmap_size=16777216")
    conn.execute("PRAGMA page_size=4096")
    conn.row_factory = sqlite3.Row


def get_connection(db_path: Path) -> sqlite3.Connection:
    global _db_conn, _db_conn_path, _db_read_conn, _db_read_conn_path
    with _db_lock:
        current_path = str(db_path)
        if _db_conn is None or _db_conn_path != current_path:
            if _db_conn is not None:
                with contextlib.suppress(Exception):
                    _db_conn.close()
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
    global _db_read_conn, _db_read_conn_path
    with _db_lock:
        current_path = str(db_path)
        if _db_read_conn is None or _db_read_conn_path != current_path:
            if _db_read_conn is not None:
                with contextlib.suppress(Exception):
                    _db_read_conn.close()
            if not db_path.exists():
                get_connection(db_path)
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
                logger.debug("Read-only connect failed; retrying with rw handle", exc_info=True)
                try:
                    _db_read_conn = sqlite3.connect(
                        current_path,
                        check_same_thread=False,
                        isolation_level=None,
                    )
                    _apply_pragmas(_db_read_conn)
                    _db_read_conn_path = current_path
                except sqlite3.Error:
                    _db_read_conn = None
                    _db_read_conn_path = None
                    raise
        return _db_read_conn


def close_connection() -> None:
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
