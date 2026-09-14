import json

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


def test_load_normalizes_stale_payload(tmp_path) -> None:
    path = tmp_path / "docs.json"
    path.write_text(json.dumps({"doc-1": {"id": "doc-1"}}), encoding="utf-8")
    db = JsonDocumentStore(path, _normalize)
    got = db.get("doc-1")
    assert got is not None
    assert got["title"] == ""
    assert got is not db._items["doc-1"]


def test_get_all_returns_deep_copies(tmp_path) -> None:
    db = JsonDocumentStore(tmp_path / "docs.json", _normalize)
    db.insert({"id": "doc-1", "title": "ok", "nested": {"flag": True}})

    items = db.get_all()
    items[0]["nested"]["flag"] = False
    items[0]["title"] = "mutated"

    stored = db.get("doc-1")
    assert stored is not None
    assert stored["nested"]["flag"] is True
    assert stored["title"] == "ok"


def test_caller_mutation_after_insert_does_not_corrupt_store(tmp_path) -> None:
    db = JsonDocumentStore(tmp_path / "docs.json", _normalize)
    payload = {"id": "doc-1", "title": "ok", "nested": {"flag": True}}
    db.insert(payload)

    payload["nested"]["flag"] = False
    payload["title"] = "mutated"

    stored = db.get("doc-1")
    assert stored is not None
    assert stored["nested"]["flag"] is True
    assert stored["title"] == "ok"


def test_failed_save_does_not_commit_in_memory(tmp_path, monkeypatch) -> None:
    db = JsonDocumentStore(tmp_path / "docs.json", _normalize)
    db.insert({"id": "doc-1", "title": "ok"})

    def boom(*args: object, **kwargs: object) -> None:
        raise OSError("disk full")

    monkeypatch.setattr("backend.core.json_store.atomic_write_text", boom)

    with pytest.raises(OSError):
        db.insert({"id": "doc-2", "title": "x"})
    with pytest.raises(OSError):
        db.update("doc-1", {"title": "nope"})
    with pytest.raises(OSError):
        db.delete("doc-1")
    with pytest.raises(OSError):
        db.replace_all_counted([{"id": "doc-3", "title": "y"}])
    with pytest.raises(OSError):
        db.clear_all()

    assert db.get("doc-1")["title"] == "ok"
    assert db.get("doc-2") is None
    assert db.get("doc-3") is None

    monkeypatch.undo()
    assert db.delete("doc-1") is True
    assert db.get("doc-1") is None
