"""Smoke test: verify schema migration works on a legacy historial install."""

import sqlite3
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import backend.core.history as history
import backend.core.database as db  # noqa: F401  - imported to ensure path resolution


def main() -> None:
    # Use a stable path so we can clean up reliably after the test.
    db_file = Path("scratch") / "_smoke_legacy.db"
    db_file.parent.mkdir(parents=True, exist_ok=True)
    if db_file.exists():
        db_file.unlink()

    try:
        # Step 1: create a legacy historial table that pre-dates the new columns.
        conn = sqlite3.connect(str(db_file))
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
            INSERT INTO historial (
                timestamp, files_json, options_json, patron, formato,
                calidad, resize, ok_count, err_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "2025-12-01T10:00:00",
                '["old.jpg"]',
                "{}",
                "{codigo}{ext}",
                "JPEG",
                90,
                None,
                1,
                0,
            ),
        )
        conn.commit()
        conn.close()

        # Reset the connection pool so the test file is opened fresh.
        try:
            history.close_connection()
        except Exception:
            pass

        # Step 2: run _ensure_table on the legacy DB. Should add the new columns.
        history.get_db_path = lambda: db_file  # type: ignore[assignment]
        history._ensure_table()

        # Step 3: verify the legacy row is still readable and new columns exist.
        conn = sqlite3.connect(str(db_file))
        rows = list(
            conn.execute(
                "SELECT id, formato, calidad, app_version, schema_version, duration_ms "
                "FROM historial"
            ).fetchall()
        )
        print("After migration (legacy row):")
        for row in rows:
            print(
                f"  id={row[0]} formato={row[1]} calidad={row[2]} "
                f"app_version={row[3]} schema_version={row[4]} duration_ms={row[5]}"
            )

        # Step 4: verify _schema_migrations has the expected entries.
        applied = [r[0] for r in conn.execute("SELECT id FROM _schema_migrations").fetchall()]
        print(f"Applied migrations: {applied}")
        assert "001_historial_baseline" in applied
        assert "002_historial_metadata" in applied
        assert "003_historial_indexes" in applied

        # Step 5: save a new run with the new schema and verify it gets app_version.
        history.save_run(
            files=["new.jpg"],
            options={"formato": "PNG", "calidad": 80},
            patron="{codigo}{ext}",
            formato="PNG",
            calidad=80,
            resize=None,
            ok_count=1,
            err_count=0,
            run_type="conversion",
            duration_ms=500,
        )
        new_row = conn.execute(
            "SELECT formato, app_version, schema_version, duration_ms "
            "FROM historial ORDER BY id DESC LIMIT 1"
        ).fetchone()
        print(
            f"New row: formato={new_row[0]} app_version={new_row[1]} "
            f"schema_version={new_row[2]} duration_ms={new_row[3]}"
        )
        assert new_row[1] is not None, "app_version must be populated"
        assert new_row[2] == 1, "schema_version must be 1 for new rows"
        assert new_row[3] == 500, "duration_ms must be persisted"

        # Step 6: verify both old and new rows coexist.
        total = conn.execute("SELECT COUNT(*) FROM historial").fetchone()[0]
        print(f"Total rows: {total} (expected 2)")
        assert total == 2, "legacy and new rows must coexist"
        conn.close()

        # Step 7: run _ensure_table again and verify no duplicate migrations.
        history._ensure_table()
        conn = sqlite3.connect(str(db_file))
        applied2 = [r[0] for r in conn.execute("SELECT id FROM _schema_migrations").fetchall()]
        assert applied == applied2, "Migrations should be idempotent"
        conn.close()

        # Step 8: CSV export from mixed-schema data.
        from backend.handlers.history import HANDLERS

        result = HANDLERS["history_export"]({})
        assert result["count"] == 2, f"Expected 2 rows in CSV, got {result['count']}"
        print(f"CSV export: count={result['count']}")
        print("SMOKE TEST PASSED")
    finally:
        # Clean up: close the connection pool and remove the test file.
        try:
            history.close_connection()
        except Exception:
            pass
        if db_file.exists():
            try:
                db_file.unlink()
            except PermissionError:
                pass


if __name__ == "__main__":
    main()
