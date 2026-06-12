"""Tests for the versioned SQLite migration system used by historial."""

from __future__ import annotations

import sqlite3

import pytest

from backend.core.migrations import MIGRATIONS_TABLE, Migration, MigrationManager


@pytest.fixture
def conn() -> sqlite3.Connection:
    """In-memory SQLite connection for migration tests."""
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    yield connection
    connection.close()


class TestMigrationManager:
    def test_apply_records_migration(self, conn: sqlite3.Connection) -> None:
        manager = MigrationManager(conn)
        m = Migration(id="t1", sql=("CREATE TABLE foo (id INTEGER)",), description="t1")
        assert manager.apply(m) is True
        assert manager.is_applied("t1")
        row = conn.execute(
            f"SELECT id, description FROM {MIGRATIONS_TABLE} WHERE id = ?", ("t1",)
        ).fetchone()
        assert row is not None
        assert row["description"] == "t1"

    def test_apply_twice_is_noop(self, conn: sqlite3.Connection) -> None:
        manager = MigrationManager(conn)
        m = Migration(id="t1", sql=("CREATE TABLE foo (id INTEGER)",))
        assert manager.apply(m) is True
        assert manager.apply(m) is False
        # foo was created exactly once
        names = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='foo'"
            ).fetchall()
        }
        assert names == {"foo"}

    def test_apply_all_runs_in_order(self, conn: sqlite3.Connection) -> None:
        manager = MigrationManager(conn)
        migrations = [
            Migration(id="a", sql=("CREATE TABLE a (x INTEGER)",)),
            Migration(id="b", sql=("CREATE TABLE b (y INTEGER)",)),
            Migration(id="c", sql=("CREATE TABLE c (z INTEGER)",)),
        ]
        applied = manager.apply_all(migrations)
        assert applied == ["a", "b", "c"]
        assert manager.applied() == {"a", "b", "c"}

    def test_apply_all_skips_already_applied(self, conn: sqlite3.Connection) -> None:
        manager = MigrationManager(conn)
        manager.apply(Migration(id="a", sql=("CREATE TABLE a (x INTEGER)",)))
        applied = manager.apply_all(
            [
                Migration(id="a", sql=("CREATE TABLE a (x INTEGER)",)),
                Migration(id="b", sql=("CREATE TABLE b (y INTEGER)",)),
            ]
        )
        assert applied == ["b"]

    def test_idempotent_add_column(self, conn: sqlite3.Connection) -> None:
        """Migrations that include 'ALTER TABLE ... ADD COLUMN' can be re-applied safely."""
        manager = MigrationManager(conn)
        manager.apply(Migration(id="init", sql=("CREATE TABLE t (id INTEGER)",)))
        # Same ALTER statement twice: second call must not raise.
        manager.apply_all(
            [
                Migration(
                    id="add_col",
                    sql=(
                        "ALTER TABLE t ADD COLUMN flag INTEGER DEFAULT 0",
                        "ALTER TABLE t ADD COLUMN flag INTEGER DEFAULT 0",
                    ),
                )
            ]
        )
        cols = {row[1] for row in conn.execute("PRAGMA table_info(t)").fetchall()}
        assert "flag" in cols

    def test_other_operational_errors_still_raise(self, conn: sqlite3.Connection) -> None:
        """Only 'duplicate column' / 'already exists' are tolerated; other errors propagate."""
        manager = MigrationManager(conn)
        with pytest.raises(sqlite3.OperationalError):
            manager.apply(Migration(id="bad", sql=("THIS IS NOT SQL",)))


class TestHistorialMigrations:
    """End-to-end check that historial's migration set produces the expected schema."""

    def test_baseline_then_metadata_columns_present(self, conn: sqlite3.Connection) -> None:
        from backend.core.history import HISTORIAL_MIGRATIONS

        manager = MigrationManager(conn)
        applied = manager.apply_all(HISTORIAL_MIGRATIONS)
        assert applied == [
            "001_historial_baseline",
            "002_historial_metadata",
            "003_historial_indexes",
        ]

        cols = {row[1]: row[2] for row in conn.execute("PRAGMA table_info(historial)").fetchall()}
        # Original columns still present
        for required in ("id", "run_type", "timestamp", "files_json", "options_json",
                          "patron", "formato", "calidad", "resize", "ok_count", "err_count"):
            assert required in cols, f"missing legacy column {required}"
        # New metadata columns present
        for added in ("schema_version", "app_version", "duration_ms"):
            assert added in cols, f"missing new column {added}"

        index_names = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='historial'"
            ).fetchall()
        }
        assert "idx_historial_ts" in index_names
        assert "idx_historial_run_type" in index_names

    def test_existing_data_preserved_across_migrations(self, conn: sqlite3.Connection) -> None:
        """Rows inserted with the legacy schema stay readable after migrating."""
        # Simulate a pre-migration legacy install: table without new columns.
        conn.execute(
            """
            CREATE TABLE historial (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_type TEXT NOT NULL DEFAULT 'conversion',
                timestamp TEXT NOT NULL,
                files_json TEXT NOT NULL,
                options_json TEXT NOT NULL,
                patron TEXT,
                formato TEXT,
                calidad INTEGER,
                resize TEXT,
                ok_count INTEGER DEFAULT 0,
                err_count INTEGER DEFAULT 0
            )
            """
        )
        conn.execute(
            """
            INSERT INTO historial (timestamp, files_json, options_json, patron, formato, calidad, resize, ok_count, err_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("2026-01-01T00:00:00", '["a.jpg"]', '{}', '{codigo}{ext}', 'JPEG', 90, None, 1, 0),
        )
        conn.commit()

        from backend.core.history import HISTORIAL_MIGRATIONS

        manager = MigrationManager(conn)
        manager.apply_all(HISTORIAL_MIGRATIONS)

        rows = [dict(r) for r in conn.execute("SELECT * FROM historial").fetchall()]
        assert len(rows) == 1
        row = rows[0]
        assert row["formato"] == "JPEG"
        assert row["calidad"] == 90
        # New columns default to NULL / 0
        assert row["app_version"] is None
        assert row["duration_ms"] is None
        assert row["schema_version"] == 0

    def test_idempotent_run_does_not_reapply(self, conn: sqlite3.Connection) -> None:
        from backend.core.history import HISTORIAL_MIGRATIONS

        manager = MigrationManager(conn)
        manager.apply_all(HISTORIAL_MIGRATIONS)
        # Second pass returns no newly applied ids.
        assert manager.apply_all(HISTORIAL_MIGRATIONS) == []
