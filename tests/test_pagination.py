"""Tests for history pagination and run_type filtering."""

from __future__ import annotations

from backend.core import database as db
from backend.core import history
from backend.core.history import _ensure_table, list_runs, save_run


def test_pagination(tmp_path, monkeypatch) -> None:
    """list_runs supports offset/limit and run_type filtering."""
    db_file = tmp_path / "test_pagination.db"
    monkeypatch.setattr(db, "get_db_path", lambda: db_file)
    monkeypatch.setattr(history, "get_db_path", lambda: db_file)
    monkeypatch.setattr(
        "backend.core.config_fields._config_file",
        lambda: tmp_path / "fields_config.json",
    )

    from backend.core.config_fields import save_fields

    save_fields([
        {"name": "codigo", "type": "TEXT", "required": True, "unique": True},
    ])
    db.init_db()
    _ensure_table()

    for i in range(10):
        save_run(
            files=[f"file{i}.jpg"],
            options={"formato": "JPEG"},
            patron="test",
            formato="JPEG",
            calidad=95,
            resize=None,
            ok_count=1,
            err_count=0,
        )

    page1 = list_runs(limit=5, offset=0)
    assert len(page1) == 5

    page2 = list_runs(limit=5, offset=5)
    assert len(page2) == 5

    assert page1[0]["id"] != page2[0]["id"], "Pages should have different results"

    all_runs = list_runs()
    assert len(all_runs) == 10

    conversion_runs = list_runs(run_type="conversion")
    assert len(conversion_runs) == 10

    empty_runs = list_runs(run_type="formato")
    assert len(empty_runs) == 0
