from __future__ import annotations

import sqlite3
import threading
import time
from pathlib import Path

from backend.core import repository


def test_sqlite_busy_timeout_pragma_applied(tmp_path: Path) -> None:
    db_path = tmp_path / "test_busy.db"
    conn = repository.get_connection(db_path)
    try:
        busy_timeout = conn.execute("PRAGMA busy_timeout;").fetchone()[0]
        assert busy_timeout == 30000

        read_conn = repository.get_read_connection(db_path)
        read_busy_timeout = read_conn.execute("PRAGMA busy_timeout;").fetchone()[0]
        assert read_busy_timeout == 30000
    finally:
        repository.close_connection()


def test_sqlite_busy_timeout_wait_behavior(tmp_path: Path) -> None:
    db_path = tmp_path / "test_lock.db"

    init_conn = repository.get_connection(db_path)
    init_conn.execute("CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT);")
    repository.close_connection()

    repo_conn = repository.get_connection(db_path)
    other_conn = sqlite3.connect(
        str(db_path),
        timeout=30.0,
        isolation_level=None,
        check_same_thread=False,
    )
    other_conn.execute("PRAGMA busy_timeout = 30000;")
    other_conn.execute("BEGIN IMMEDIATE;")

    def release_after() -> None:
        time.sleep(0.35)
        other_conn.execute("COMMIT;")
        other_conn.close()

    t = threading.Thread(target=release_after)
    t.start()

    try:
        start_time = time.monotonic()
        repo_conn.execute("INSERT INTO test (val) VALUES ('success');")
        elapsed = time.monotonic() - start_time

        assert elapsed >= 0.25, f"Debería haber esperado la liberación del lock (elapsed={elapsed}s)"
        rows = repo_conn.execute("SELECT val FROM test;").fetchall()
        assert len(rows) == 1
        assert rows[0]["val"] == "success"
    finally:
        t.join(timeout=3.0)
        repository.close_connection()
