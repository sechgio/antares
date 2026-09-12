
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from backend.core import canvas as canvas_core
from backend.core.canvas.models import create_empty_document
from backend.core.canvas.store import CanvasStore
from backend.core.exceptions import MemoryPressureError, NotFoundError
from backend.handlers import canvas as canvas_handlers


def _install_store(monkeypatch: pytest.MonkeyPatch, store: CanvasStore) -> None:
    monkeypatch.setattr(canvas_core, "get_canvas_store", lambda: store)


def _force_memory_pressure(monkeypatch: pytest.MonkeyPatch, pressured: bool) -> None:
    monkeypatch.setattr(canvas_handlers, "is_memory_pressure", lambda: pressured)
    monkeypatch.setattr(canvas_handlers, "_available_bytes", lambda: 512 * 1024 * 1024)


def test_successful_retry_cleans_document_spill(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = CanvasStore(tmp_path)
    _install_store(monkeypatch, store)
    document = create_empty_document(name="Spilled")

    _force_memory_pressure(monkeypatch, True)
    with pytest.raises(MemoryPressureError) as caught:
        canvas_handlers.canvas_save({"document": document})

    spill_path = Path(caught.value.details["spill_path"])
    assert spill_path.is_file()
    assert spill_path.name == f"document__{document['id']}.json"

    _force_memory_pressure(monkeypatch, False)
    result = canvas_handlers.canvas_save({"document": document})

    assert result["document"]["id"] == document["id"]
    assert not spill_path.exists()


def test_successful_retry_cleans_history_spill(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = CanvasStore(tmp_path)
    _install_store(monkeypatch, store)
    document = store.create(name="History")
    past = [create_empty_document(name="Past")]

    _force_memory_pressure(monkeypatch, True)
    with pytest.raises(MemoryPressureError) as caught:
        canvas_handlers.canvas_save_history({"id": document["id"], "past": past, "future": []})

    spill_path = Path(caught.value.details["spill_path"])
    assert spill_path.is_file()

    _force_memory_pressure(monkeypatch, False)
    result = canvas_handlers.canvas_save_history({"id": document["id"], "past": past, "future": []})

    assert result == {"success": True}
    assert not spill_path.exists()


def test_delete_cleans_document_and_history_spills(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = CanvasStore(tmp_path)
    _install_store(monkeypatch, store)
    document = store.create(name="Delete me")
    document_id = str(document["id"])
    document_spill = Path(canvas_handlers._spill_payload(document_id, document) or "")
    history_spill = Path(canvas_handlers._spill_payload(document_id, {"past": [], "future": []}, "_history.json") or "")
    assert document_spill.is_file()
    assert history_spill.is_file()

    result = canvas_handlers.canvas_delete({"id": document_id})

    assert result == {"success": True, "deleted_id": document_id}
    assert not document_spill.exists()
    assert not history_spill.exists()


def test_delete_cleans_spills_when_document_is_not_persisted(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = CanvasStore(tmp_path)
    _install_store(monkeypatch, store)
    document = create_empty_document(name="Pending delete")
    document_id = str(document["id"])
    document_spill = Path(canvas_handlers._spill_payload(document_id, document) or "")
    history_spill = Path(
        canvas_handlers._spill_payload(document_id, {"past": [], "future": []}, "_history.json") or "",
    )

    with pytest.raises(NotFoundError):
        canvas_handlers.canvas_delete({"id": document_id})

    assert not document_spill.exists()
    assert not history_spill.exists()


def test_failed_spill_removes_partial_temp_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = CanvasStore(tmp_path)
    _install_store(monkeypatch, store)

    original_write_bytes = Path.write_bytes

    def fail_write(self: Path, data: bytes) -> int:
        if self.suffix == ".tmp":
            raise OSError("disk full")
        return original_write_bytes(self, data)

    monkeypatch.setattr(Path, "write_bytes", fail_write)

    assert canvas_handlers._spill_payload("doc-temp", {"name": "pending"}) is None
    spill_dir = tmp_path.parent / "spill"
    assert list(spill_dir.glob("*.tmp")) == []


def test_new_store_recovers_pending_document_spill(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = CanvasStore(tmp_path)
    _install_store(monkeypatch, store)
    document = create_empty_document(name="Recover me")

    spill_path = Path(canvas_handlers._spill_payload(str(document["id"]), document) or "")
    assert spill_path.is_file()

    recovered = CanvasStore(tmp_path, migrate_legacy=False)

    assert recovered.get(str(document["id"])) == document
    assert not spill_path.exists()


def test_new_store_recovers_pending_history_spill(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = CanvasStore(tmp_path)
    _install_store(monkeypatch, store)
    document = store.create(name="Recover history")
    payload = {"past": [create_empty_document(name="Past")], "future": []}

    spill_path = Path(
        canvas_handlers._spill_payload(str(document["id"]), payload, "_history.json") or "",
    )
    assert spill_path.is_file()

    recovered = CanvasStore(tmp_path, migrate_legacy=False)

    history = recovered.get_history(str(document["id"]))
    assert history["past"][0]["name"] == "Past"
    assert not spill_path.exists()


def test_document_and_history_spills_do_not_collide_for_suffix_ids(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = CanvasStore(tmp_path)
    _install_store(monkeypatch, store)
    document_id = "report_history"
    history_id = "report"
    document = create_empty_document(name="Document survives")
    document["id"] = document_id
    history = {"past": [create_empty_document(name="History survives")], "future": []}

    document_spill = Path(canvas_handlers._spill_payload(document_id, document) or "")
    history_spill = Path(canvas_handlers._spill_payload(history_id, history, "_history.json") or "")

    assert document_spill != history_spill
    assert document_spill.is_file()
    assert history_spill.is_file()

    recovered = CanvasStore(tmp_path, migrate_legacy=False)

    assert recovered.get(document_id)["name"] == "Document survives"
    assert recovered.get_history(history_id)["past"][0]["name"] == "History survives"


def test_concurrent_spills_use_distinct_temp_files(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = CanvasStore(tmp_path)
    _install_store(monkeypatch, store)
    replaced: list[str] = []
    original_replace = Path.replace

    def capture_replace(self: Path, target: Path) -> Path:
        replaced.append(self.name)
        return original_replace(self, target)

    monkeypatch.setattr(Path, "replace", capture_replace)
    document = create_empty_document(name="Concurrent")

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: canvas_handlers._spill_payload("same-id", document), range(2)))

    assert all(results)
    assert len(set(replaced)) == 2
    assert not list((tmp_path.parent / "spill").glob("*.tmp"))
