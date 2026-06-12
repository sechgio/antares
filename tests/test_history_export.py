"""Tests for the date range, CSV export and bulk delete handlers."""

from __future__ import annotations

import base64
import csv
import io

import pytest

from backend.core.history import _ensure_table, save_run
from backend.handlers.history import HANDLERS


@pytest.fixture
def seeded_db(tmp_path, monkeypatch):
    """Create a temp DB and seed it with three runs on different days."""
    db_file = tmp_path / "test.db"
    monkeypatch.setattr("backend.core.history.get_db_path", lambda: db_file)
    _ensure_table()

    runs = [
        # (timestamp-iso, run_type, formato, ok, err, duration_ms)
        ("2026-01-01T10:00:00", "conversion", "JPEG", 5, 0, 1500),
        ("2026-01-15T10:00:00", "conversion", "PNG", 3, 1, 2200),
        ("2026-02-01T10:00:00", "formato", "PDF-A4", 1, 0, 800),
    ]
    for ts, run_type, formato, ok, err, dur in runs:
        # We can't override timestamp via save_run, so we build a class
        # whose ``now`` captures the current `ts` via a default argument.
        # This sidesteps B023 (late-binding closure) and the timezone arg
        # that save_run passes to datetime.now.
        from datetime import datetime

        class FakeDateTime:
            @classmethod
            def now(cls, tz=None, _ts=ts):
                return datetime.fromisoformat(_ts)

        monkeypatch.setattr("backend.core.history.datetime", FakeDateTime)
        save_run(
            files=["a.jpg"],
            options={"formato": formato, "calidad": 90},
            patron="test",
            formato=formato,
            calidad=90,
            resize=None,
            ok_count=ok,
            err_count=err,
            run_type=run_type,
            duration_ms=dur,
        )
    return db_file, runs


def test_history_list_filters_by_date_range(seeded_db) -> None:
    _db_file, _runs = seeded_db
    result = HANDLERS["history_list"]({"date_from": "2026-01-10T00:00:00", "date_to": "2026-01-31T23:59:59"})
    timestamps = [r["timestamp"] for r in result["runs"]]
    assert any("2026-01-15" in ts for ts in timestamps)
    assert not any("2026-01-01" in ts for ts in timestamps)
    assert not any("2026-02-01" in ts for ts in timestamps)


def test_history_list_combines_type_and_date(seeded_db) -> None:
    _db_file, _runs = seeded_db
    result = HANDLERS["history_list"]({
        "run_type": "formato",
        "date_from": "2026-01-01T00:00:00",
        "date_to": "2026-12-31T23:59:59",
    })
    assert len(result["runs"]) == 1
    assert result["runs"][0]["run_type"] == "formato"


def test_history_export_csv_with_filter(seeded_db) -> None:
    _db_file, _runs = seeded_db
    result = HANDLERS["history_export"]({
        "run_type": "conversion",
        "date_from": "2026-01-01T00:00:00",
        "date_to": "2026-01-31T23:59:59",
    })
    assert result["count"] == 2
    text = base64.b64decode(result["csv"]).decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    assert len(rows) == 2
    columns = reader.fieldnames or []
    # New schema columns must be exported.
    for required in ("id", "run_type", "timestamp", "duration_ms", "app_version", "schema_version"):
        assert required in columns


def test_history_export_csv_by_ids(seeded_db) -> None:
    db_file, _runs = seeded_db
    import sqlite3
    with sqlite3.connect(str(db_file)) as conn:
        ids = [row[0] for row in conn.execute("SELECT id FROM historial ORDER BY id LIMIT 2").fetchall()]

    result = HANDLERS["history_export"]({"ids": ids})
    assert result["count"] == 2
    text = base64.b64decode(result["csv"]).decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    exported_ids = {int(r["id"]) for r in rows}
    assert exported_ids == set(ids)


def test_history_export_csv_skips_missing_ids(seeded_db) -> None:
    _db_file, _runs = seeded_db
    result = HANDLERS["history_export"]({"ids": [1, 999, 2]})
    # ids 1 and 2 exist, 999 does not — it must be silently dropped
    assert result["count"] == 2


def test_history_delete_many(seeded_db) -> None:
    _db_file, _runs = seeded_db
    result = HANDLERS["history_delete_many"]({"ids": [1, 2]})
    assert result == {"deleted": 2, "requested": 2}
    # The third row remains
    remaining = HANDLERS["history_list"]({})["runs"]
    assert len(remaining) == 1


def test_history_export_csv_drops_missing_gracefully(seeded_db) -> None:
    _db_file, _runs = seeded_db
    # All-missing ids produce a CSV with only the header row.
    result = HANDLERS["history_export"]({"ids": [998, 999]})
    assert result["count"] == 0
    text = base64.b64decode(result["csv"]).decode("utf-8")
    rows = list(csv.DictReader(io.StringIO(text)))
    assert rows == []
