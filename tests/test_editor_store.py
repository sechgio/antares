from __future__ import annotations

import json
import threading
from pathlib import Path

import pytest

from backend.core.editor.models import EditorContractError
from backend.core.editor.store import EditorStore, new_project_document


@pytest.fixture()
def store(tmp_path: Path) -> EditorStore:
    return EditorStore(tmp_path)


def test_create_returns_valid_document(store: EditorStore) -> None:
    result = store.create("Mi video")
    doc = result["project"]
    assert doc["schemaVersion"] == 1
    assert doc["name"] == "Mi video"
    assert doc["revision"] == 1
    assert store.get(doc["id"]) == doc


@pytest.mark.parametrize("newest_first", [False, True])
def test_list_orders_by_updated_at_desc(store: EditorStore, monkeypatch: pytest.MonkeyPatch, newest_first: bool) -> None:
    timestamps = ["2026-10-22T12:00:00.000Z", "2026-10-22T12:00:00.001Z"]
    if newest_first:
        timestamps.reverse()
    clock = iter(timestamps)
    monkeypatch.setattr("backend.core.editor.store.utc_now_iso", lambda: next(clock))
    a = store.create("A")["project"]
    b = store.create("B")["project"]
    listed = store.list_projects()
    ids = [item["id"] for item in listed]
    assert ids == ([a["id"], b["id"]] if newest_first else [b["id"], a["id"]])


def test_get_missing_returns_none(store: EditorStore) -> None:
    assert store.get("no-existe") is None


def test_get_invalid_id_rejected(store: EditorStore) -> None:
    with pytest.raises(EditorContractError):
        store.get("../etc/passwd")


def test_save_with_expected_revision_advances(store: EditorStore) -> None:
    created = store.create("P")["project"]
    doc = json.loads(json.dumps(created))
    doc["name"] = "P renombrado"
    saved = store.save(doc, expected_revision=1)["project"]
    assert saved["revision"] == 2
    assert saved["name"] == "P renombrado"
    reloaded = store.get(created["id"])
    assert reloaded is not None and reloaded["revision"] == 2


def test_save_with_stale_revision_rejected(store: EditorStore) -> None:
    created = store.create("P")["project"]
    doc = json.loads(json.dumps(created))
    doc["name"] = "editado"
    with pytest.raises(EditorContractError, match="revision"):
        store.save(doc, expected_revision=99)


def test_save_of_unknown_project_rejected(store: EditorStore) -> None:
    doc = new_project_document("fantasma")
    with pytest.raises(EditorContractError, match="no existe"):
        store.save(doc, expected_revision=1)


def test_repeated_request_returns_same_result_without_double_bump(store: EditorStore) -> None:
    first = store.create("P", request_id="req-1")
    second = store.create("P otra vez", request_id="req-1")
    assert second == first
    assert store.get(first["project"]["id"])["revision"] == 1
    assert len(store.list_projects()) == 1


def test_repeated_save_request_returns_same_revision(store: EditorStore) -> None:
    created = store.create("P", request_id="req-c")["project"]
    doc = json.loads(json.dumps(created))
    doc["name"] = "uno"
    first = store.save(doc, expected_revision=1, request_id="req-s")["project"]
    assert first["revision"] == 2
    doc2 = json.loads(json.dumps(first))
    doc2["name"] = "dos"
    again = store.save(doc2, expected_revision=2, request_id="req-s")["project"]
    assert again["revision"] == 2
    reloaded = store.get(created["id"])
    assert reloaded is not None and reloaded["revision"] == 2


def test_delete_moves_to_trash(store: EditorStore) -> None:
    created = store.create("P")["project"]
    pid = created["id"]
    assert store.delete(pid)["trash"] is True
    assert store.get(pid) is None


def test_delete_twice_rejected(store: EditorStore) -> None:
    created = store.create("P")["project"]
    store.delete(created["id"])
    with pytest.raises(EditorContractError):
        store.delete(created["id"])


def test_duplicate_shares_content_with_new_identity(store: EditorStore) -> None:
    created = store.create("Original")["project"]
    created["clips"] = []
    store.save(created, expected_revision=1)
    dup = store.duplicate(created["id"], "Copia")["project"]
    assert dup["id"] != created["id"]
    assert dup["name"] == "Copia"
    assert dup["tracks"] == created["tracks"]
    assert store.get(dup["id"]) is not None


def test_duplicate_of_missing_rejected(store: EditorStore) -> None:
    with pytest.raises(EditorContractError):
        store.duplicate("no-existe")


def test_project_ids_are_path_safe(tmp_path: Path) -> None:
    store = EditorStore(tmp_path)
    created = store.create("P")["project"]
    with pytest.raises(EditorContractError):
        store.save({**created, "id": "../../malicioso"}, expected_revision=1)


def test_saved_document_round_trips_through_disk(store: EditorStore) -> None:
    created = store.create("P")["project"]
    on_disk = json.loads((store.projects_dir / f"{created['id']}.json").read_text(encoding="utf-8"))
    assert on_disk == created


def test_recovery_copy_written_before_replace(store: EditorStore) -> None:
    created = store.create("P")["project"]
    doc = json.loads(json.dumps(created))
    doc["name"] = "v2"
    store.save(doc, expected_revision=1)
    recovery = store.recovery_dir / f"{created['id']}.json"
    assert recovery.is_file()
    old = json.loads(recovery.read_text(encoding="utf-8"))
    assert old["name"] == "P"


def test_no_tmp_files_left_behind(store: EditorStore) -> None:
    store.create("A")
    store.create("B")
    leftovers = list(store.projects_dir.glob(".*.tmp"))
    assert leftovers == []


def test_concurrent_creates_are_all_persisted(tmp_path: Path) -> None:
    store = EditorStore(tmp_path)
    created: list[str] = []
    lock = threading.Lock()

    def worker(i: int) -> None:
        result = store.create(f"P{i}")
        with lock:
            created.append(result["project"]["id"])

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(created) == 8
    assert len(store.list_projects()) == 8
