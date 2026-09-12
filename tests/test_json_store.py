import pytest

from backend.core.json_store import JsonDocumentStore


def _normalize(item: dict) -> dict:
    payload = dict(item)
    payload.setdefault("id", "doc-1")
    payload.setdefault("title", "")
    payload["title"] = str(payload["title"])
    return payload


def test_get_insert_update_replace_roundtrip(tmp_path) -> None:
    db = JsonDocumentStore(tmp_path / "docs.json", _normalize)

    created = db.insert({"id": "doc-1", "title": 12})
    assert created["title"] == "12"
    created["title"] = "mutated"
    assert db.get("doc-1")["title"] == "12"

    updated = db.update("doc-1", {"title": "next"})
    assert updated["id"] == "doc-1"
    assert db.get("doc-1")["title"] == "next"

    replaced, _deleted = db.replace_all_counted([{"id": "doc-2", "title": "other"}])
    assert [item["id"] for item in replaced] == ["doc-2"]
    assert db.get("doc-1") is None
    assert db.get("doc-2")["title"] == "other"


def test_update_missing_uses_template(tmp_path) -> None:
    class Reports(JsonDocumentStore):
        not_found_template = "Informe no encontrado: {id}"

    db = Reports(tmp_path / "docs.json", _normalize)
    with pytest.raises(KeyError, match="Informe no encontrado: missing"):
        db.update("missing", {"title": "x"})


def test_get_renormalizes_stale_payload(tmp_path) -> None:
    db = JsonDocumentStore(tmp_path / "docs.json", _normalize)
    db.insert({"id": "doc-1", "title": "ok"})
    db._items["doc-1"] = {"id": "doc-1"}
    got = db.get("doc-1")
    assert got is not None
    assert got["title"] == ""
    assert got is not db._items["doc-1"]
