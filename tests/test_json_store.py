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


def test_reads_do_not_serialize_documents_to_copy_them(tmp_path, monkeypatch) -> None:
    from backend.core import json_store

    db = JsonDocumentStore(tmp_path / "docs.json", _normalize)
    db.insert({"id": "doc-1", "title": "ok", "nested": {"flag": True}})

    def fail_dumps(*_args: object, **_kwargs: object) -> str:
        raise AssertionError("reads must not serialize documents just to detach them")

    monkeypatch.setattr(json_store.json, "dumps", fail_dumps)

    assert db.get("doc-1") == {"id": "doc-1", "title": "ok", "nested": {"flag": True}}
    assert db.get_all() == [{"id": "doc-1", "title": "ok", "nested": {"flag": True}}]


def test_get_many_copies_only_requested_documents(tmp_path) -> None:
    db = JsonDocumentStore(tmp_path / "docs.json", _normalize)
    db.insert({"id": "doc-1", "title": "one"})
    db.insert({"id": "doc-2", "title": "two"})

    get_many = getattr(db, "get_many", lambda _ids: None)
    selected = get_many(["doc-2", "missing"])

    assert selected == [{"id": "doc-2", "title": "two"}]


def test_project_all_returns_detached_projections(tmp_path) -> None:
    db = JsonDocumentStore(tmp_path / "docs.json", _normalize)
    db.insert({"id": "doc-1", "title": "one", "nested": {"flag": True}})

    project_all = getattr(db, "project_all", lambda _projector: None)
    projected = project_all(lambda item: {"id": item["id"], "flag": item["nested"]["flag"]})

    assert projected == [{"id": "doc-1", "flag": True}]


def test_repeated_updates_reuse_unchanged_serialized_documents(tmp_path, monkeypatch) -> None:
    from backend.core import json_store

    db = JsonDocumentStore(tmp_path / "docs.json", _normalize)
    db.insert({"id": "doc-1", "title": "one", "nested": {"value": "a" * 1000}})
    db.insert({"id": "doc-2", "title": "two", "nested": {"value": "b" * 1000}})
    db.update("doc-1", {"title": "warm", "nested": {"value": "c" * 1000}})
    real_dumps = json_store.json.dumps
    serialized_full_store = 0
    serialized_documents: list[str] = []

    def tracking_dumps(value, *args, **kwargs):
        nonlocal serialized_full_store
        if isinstance(value, dict) and {"doc-1", "doc-2"}.issubset(value):
            serialized_full_store += 1
        if isinstance(value, dict) and value.get("id"):
            serialized_documents.append(str(value["id"]))
        return real_dumps(value, *args, **kwargs)

    monkeypatch.setattr(json_store.json, "dumps", tracking_dumps)

    db.update("doc-1", {"title": "changed", "nested": {"value": "d" * 1000}})

    assert serialized_full_store == 0
    assert serialized_documents == ["doc-1"]


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
