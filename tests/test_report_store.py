from __future__ import annotations

import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from backend.core.report_store import ReportStore, resolve_report_store_paths


def _normalize(item: dict[str, Any]) -> dict[str, Any]:
    return {"id": str(item["id"]), "value": str(item.get("value") or "")}


def _empty_document(number: int) -> dict[str, Any]:
    return {"id": f"R-{number}", "value": ""}


def _next_number(items: list[dict[str, Any]]) -> int:
    return max((int(str(item["id"]).split("-")[-1]) for item in items), default=0) + 1


def test_create_and_create_empty_return_detached_normalized_documents(tmp_path: Path) -> None:
    store = ReportStore(tmp_path / "reports.json", _normalize, _empty_document, _next_number)

    created = store.create({"id": 7, "value": 12})
    created["value"] = "mutated"
    empty = store.create_empty()

    assert store.get("7") == {"id": "7", "value": "12"}
    assert empty == {"id": "R-8", "value": ""}


def test_create_empty_allocates_unique_ids_across_threads(tmp_path: Path) -> None:
    store = ReportStore(tmp_path / "reports.json", _normalize, _empty_document, _next_number)

    with ThreadPoolExecutor(max_workers=4) as executor:
        ids = list(executor.map(lambda _index: store.create_empty()["id"], range(12)))

    assert sorted(ids, key=lambda item: int(item.split("-")[-1])) == [f"R-{number}" for number in range(1, 13)]


def test_resolve_report_store_paths_enables_legacy_only_for_development_default(
    tmp_path: Path,
    monkeypatch,
) -> None:
    default_path = tmp_path / "user" / "reports.json"
    legacy_path = tmp_path / "data" / "reports.json"

    path, legacy = resolve_report_store_paths(None, default_path, default_path, legacy_path)
    assert path == default_path
    assert legacy == legacy_path

    custom_path = tmp_path / "custom.json"
    path, legacy = resolve_report_store_paths(custom_path, default_path, default_path, legacy_path)
    assert path == custom_path
    assert legacy is None

    monkeypatch.setattr(sys, "frozen", True, raising=False)
    path, legacy = resolve_report_store_paths(None, default_path, default_path, legacy_path)
    assert path == default_path
    assert legacy is None
