from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from backend.core.exceptions import DatabaseError
from backend.core.fichas_tecnicas.database import FichasTecnicasDB
from backend.core.informes_v2.database import InformesV2DB
from backend.core.json_store import JsonDocumentStore
from backend.core.technical_reports.database import TechnicalReportsDB


def _normalize(item: dict[str, object]) -> dict[str, object]:
    return {"id": str(item["id"]), "value": item.get("value", "")}


def test_legacy_store_is_imported_when_user_store_is_missing(tmp_path: Path) -> None:
    target = tmp_path / "user" / "informes_v2.json"
    legacy = tmp_path / "data" / "informes_v2.json"
    legacy.parent.mkdir()
    legacy.write_text(json.dumps({"R-1": {"id": "R-1", "value": "legacy"}}), encoding="utf-8")

    store = JsonDocumentStore(target, _normalize, legacy_path=legacy)

    assert store.get("R-1") == {"id": "R-1", "value": "legacy"}
    assert json.loads(legacy.read_text(encoding="utf-8"))["R-1"]["value"] == "legacy"
    assert target.exists()


def test_legacy_store_repairs_empty_user_store_created_by_previous_release(tmp_path: Path) -> None:
    target = tmp_path / "user" / "informes_v2.json"
    legacy = tmp_path / "data" / "informes_v2.json"
    target.parent.mkdir()
    legacy.parent.mkdir()
    target.write_text("{}", encoding="utf-8")
    legacy.write_text(json.dumps({"R-1": {"id": "R-1", "value": "legacy"}}), encoding="utf-8")

    store = JsonDocumentStore(target, _normalize, legacy_path=legacy)

    assert store.get_all() == [{"id": "R-1", "value": "legacy"}]


def test_legacy_migration_is_idempotent_and_does_not_resurrect_after_clear(tmp_path: Path) -> None:
    target = tmp_path / "user" / "informes_v2.json"
    legacy = tmp_path / "data" / "informes_v2.json"
    legacy.parent.mkdir()
    legacy.write_text(json.dumps({"R-1": {"id": "R-1", "value": "legacy"}}), encoding="utf-8")

    first = JsonDocumentStore(target, _normalize, legacy_path=legacy)
    first_bytes = target.read_bytes()
    first.clear_all()

    second = JsonDocumentStore(target, _normalize, legacy_path=legacy)

    assert first_bytes != target.read_bytes()
    assert second.get_all() == []
    assert legacy.exists()


def test_legacy_migration_merges_records_with_user_store_winning_conflicts(tmp_path: Path) -> None:
    target = tmp_path / "user" / "informes_v2.json"
    legacy = tmp_path / "data" / "informes_v2.json"
    target.parent.mkdir()
    legacy.parent.mkdir()
    target.write_text(
        json.dumps(
            {
                "same": {"id": "same", "value": "user"},
                "new": {"id": "new", "value": "user-only"},
            }
        ),
        encoding="utf-8",
    )
    legacy.write_text(
        json.dumps(
            {
                "same": {"id": "same", "value": "legacy"},
                "old": {"id": "old", "value": "legacy-only"},
            }
        ),
        encoding="utf-8",
    )

    store = JsonDocumentStore(target, _normalize, legacy_path=legacy)

    assert {item["id"]: item["value"] for item in store.get_all()} == {
        "same": "user",
        "new": "user-only",
        "old": "legacy-only",
    }


def test_corrupt_legacy_does_not_crash_when_user_store_is_missing(tmp_path: Path) -> None:
    target = tmp_path / "user" / "informes_v2.json"
    legacy = tmp_path / "data" / "informes_v2.json"
    legacy.parent.mkdir()
    legacy.write_text('{"broken": ', encoding="utf-8")

    store = JsonDocumentStore(target, _normalize, legacy_path=legacy)

    assert store.get_all() == []


def test_legacy_migration_does_not_replace_corrupt_user_store(tmp_path: Path) -> None:
    target = tmp_path / "user" / "informes_v2.json"
    legacy = tmp_path / "data" / "informes_v2.json"
    target.parent.mkdir()
    legacy.parent.mkdir()
    target.write_text('{"broken": ', encoding="utf-8")
    legacy.write_text(json.dumps({"R-1": {"id": "R-1", "value": "legacy"}}), encoding="utf-8")
    original_target = target.read_text(encoding="utf-8")

    with pytest.raises(DatabaseError, match="corrupto"):
        JsonDocumentStore(target, _normalize, legacy_path=legacy)

    assert target.read_text(encoding="utf-8") == original_target
    assert legacy.read_text(encoding="utf-8")
    assert list(target.parent.glob("informes_v2.json.corrupt.*.bak"))


def test_frozen_default_store_does_not_import_development_legacy_data(
    monkeypatch,
    tmp_path: Path,
) -> None:
    import backend.core.fichas_tecnicas.database as module

    target = tmp_path / "fichas_tecnicas.json"
    legacy = tmp_path / "data" / "fichas_tecnicas.json"
    legacy.parent.mkdir()
    legacy.write_text(json.dumps({"FT-1": {"id": "FT-1", "cliente": "legacy"}}), encoding="utf-8")

    monkeypatch.setattr(module, "DEFAULT_DB_PATH", target)
    monkeypatch.setattr(module, "_DEFAULT_USER_DATA_PATH", target)
    monkeypatch.setattr(module, "_LEGACY_DB_PATH", legacy)
    monkeypatch.setattr(sys, "frozen", True, raising=False)

    store = module.FichasTecnicasDB()

    assert store.get_all() == []


@pytest.mark.parametrize(
    ("module_name", "store_class", "filename"),
    [
        ("backend.core.fichas_tecnicas.database", FichasTecnicasDB, "fichas_tecnicas.json"),
        ("backend.core.informes_v2.database", InformesV2DB, "informes_v2.json"),
        ("backend.core.technical_reports.database", TechnicalReportsDB, "technical_reports.json"),
    ],
)
def test_default_store_wiring_passes_legacy_path_only_for_real_default(
    monkeypatch,
    tmp_path: Path,
    module_name: str,
    store_class: type[JsonDocumentStore],
    filename: str,
) -> None:
    module = __import__(module_name, fromlist=["*"])
    target = tmp_path / filename
    legacy = tmp_path / "data" / filename
    legacy.parent.mkdir()
    legacy.write_text(json.dumps({"item": {"id": "item"}}), encoding="utf-8")

    monkeypatch.setattr(module, "DEFAULT_DB_PATH", target)
    monkeypatch.setattr(module, "_DEFAULT_USER_DATA_PATH", target)
    monkeypatch.setattr(module, "_LEGACY_DB_PATH", legacy)

    store = store_class()

    assert store.get("item") is not None
