from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

from backend.core.json_store import JsonDocumentStore
from backend.handlers.common import import_into_store


def _normalize(item: dict[str, Any]) -> dict[str, Any]:
    return {"id": str(item["id"]), "value": str(item.get("value") or "")}


def test_import_into_store_replaces_items_and_preserves_response_contract(tmp_path: Path) -> None:
    store = JsonDocumentStore(tmp_path / "items.json", _normalize)
    store.insert({"id": "old-1", "value": "one"})
    store.insert({"id": "old-2", "value": "two"})
    received: list[tuple[str, bytes]] = []

    def importer(filename: str, content: bytes) -> list[dict[str, Any]]:
        received.append((filename, content))
        return [{"id": "new-1", "value": "new"}]

    result = import_into_store(
        store,
        {
            "filename": "reports.csv",
            "content_b64": base64.b64encode(b"id;value\nnew-1;new\n").decode("ascii"),
        },
        importer,
        "informes importados",
    )

    assert received == [("reports.csv", b"id;value\nnew-1;new\n")]
    assert store.get_all() == [{"id": "new-1", "value": "new"}]
    assert result == {
        "success": True,
        "message": "1 informes importados",
        "deleted_count": 2,
        "imported_count": 1,
        "total_rows_in_file": 1,
    }
