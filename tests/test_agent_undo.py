from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path

import pytest

from backend.core.agent import agent
from backend.core.agent import undo as undo_journal
from backend.core.exceptions import ValidationError
from backend.handlers import agent_internal


@pytest.fixture()
def store(tmp_path, monkeypatch):
    instance = agent.AgentStore(tmp_path)
    monkeypatch.setattr(agent, "get_agent_store", lambda: instance)
    monkeypatch.setattr(agent, "_runner_singleton", agent.AgentRunner(instance, lambda _: None))
    monkeypatch.setattr(agent_internal, "_resource_locks", {})
    monkeypatch.setattr(agent_internal, "_native_leases", {})
    return instance


def _approve(session_id: str, call_id: str, method: str, params: dict, *, channel: str = "files",
             source: str = "manual") -> dict:
    approval = agent_internal.HANDLERS["agent_internal_approval_ensure"]({
        "session_id": session_id, "call_id": call_id, "method": method, "params": params, "channel": channel,
    })["approval"]
    agent_internal.HANDLERS["agent_internal_approval_decide"](
        {"approval_id": approval["id"], "approve": True, "source": source},
    )
    return approval


def _run(session_id: str, call_id: str, method: str, params: dict, *,
         channel: str = "files", source: str = "manual") -> str:
    approval = _approve(session_id, call_id, method, params, channel=channel, source=source)
    first = agent_internal.HANDLERS["agent_internal_dispatch"]({
        "session_id": session_id, "call_id": call_id, "name": method, "params": params,
        "approval_id": approval["id"], "channel": channel,
    })
    assert first["result"] is None
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        out = agent_internal.HANDLERS["agent_internal_dispatch_result"]({
            "session_id": session_id, "call_id": call_id,
        })
        if out["result"] is not None:
            return str(out["result"])
        time.sleep(0.02)
    raise AssertionError(f"dispatch {call_id} no terminó")


def _undo(session_id: str, call_id: str) -> dict:
    return agent_internal.HANDLERS["agent_internal_effect_undo"]({
        "session_id": session_id, "call_id": call_id,
    })


def _effects(session_id: str) -> list[dict]:
    return agent_internal.HANDLERS["agent_internal_effects"]({"session_id": session_id})["dispatches"]


def test_fs_write_new_file_undo_deletes_it(store):
    session_id = store.create_session("provider", "model", "Undo")["id"]
    path = store.drafts_dir(session_id) / "nuevo.txt"
    _run(session_id, "call-1", "fs_write", {"path": "nuevo.txt", "content": "hola"}, source="rule")

    assert path.read_text(encoding="utf-8") == "hola"
    receipt = next(item for item in _effects(session_id) if item["call_id"] == "call-1")
    assert receipt["approval_source"] == "rule" and receipt["channel"] == "files"
    assert receipt["undo"]["available"] is True and receipt["undo"]["kind"] == "delete"

    assert _undo(session_id, "call-1")["undone"] is True
    assert not path.exists()
    with pytest.raises(ValidationError):
        _undo(session_id, "call-1")


def test_fs_write_overwrite_undo_restores_previous_content(store):
    session_id = store.create_session("provider", "model", "Undo")["id"]
    path = store.drafts_dir(session_id) / "existente.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("original", encoding="utf-8")

    _run(session_id, "call-2", "fs_write",
         {"path": "existente.txt", "content": "cambiado", "overwrite": True})
    assert path.read_text(encoding="utf-8") == "cambiado"

    _undo(session_id, "call-2")
    assert path.read_text(encoding="utf-8") == "original"


def test_fs_edit_undo_restores_previous_content(store):
    session_id = store.create_session("provider", "model", "Undo")["id"]
    path = store.drafts_dir(session_id) / "editable.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("antes", encoding="utf-8")

    _run(session_id, "call-3", "fs_edit",
         {"path": "editable.txt", "old": "antes", "new": "después"})
    assert path.read_text(encoding="utf-8") == "después"

    _undo(session_id, "call-3")
    assert path.read_text(encoding="utf-8") == "antes"


def test_undo_refuses_to_overwrite_later_changes(store):
    session_id = store.create_session("provider", "model", "Undo")["id"]
    path = store.drafts_dir(session_id) / "cambios.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("original", encoding="utf-8")
    _run(session_id, "call-4", "fs_write",
         {"path": "cambios.txt", "content": "del agente", "overwrite": True})
    path.write_text("cambio externo", encoding="utf-8")

    with pytest.raises(ValidationError):
        _undo(session_id, "call-4")
    assert path.read_text(encoding="utf-8") == "cambio externo"


def test_effects_expose_receipt_without_raw_result(store):
    session_id = store.create_session("provider", "model", "Undo")["id"]
    _run(session_id, "call-5", "fs_write", {"path": "recibo.txt", "content": "ok"})

    [receipt] = _effects(session_id)
    assert receipt["call_id"] == "call-5"
    assert receipt["approval_source"] == "manual"
    assert receipt["undo"]["kind"] == "delete"
    assert "result" not in receipt
    assert json.dumps(receipt)  # el recibo es serializable para IPC


def _draft(store: agent.AgentStore, session_id: str, content: str) -> Path:
    draft = store.drafts_dir(session_id) / "borrador.txt"
    draft.parent.mkdir(parents=True, exist_ok=True)
    draft.write_text(content, encoding="utf-8")
    return draft


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_drafts_save_new_file_undo_deletes_the_destination(store):
    session_id = store.create_session("provider", "model", "Undo")["id"]
    _draft(store, session_id, "contenido")
    destination = store.base_dir / "entregas"
    destination.mkdir()
    target = destination / "borrador.txt"

    saved = json.loads(_run(session_id, "call-d1", "drafts_save",
                            {"name": "borrador.txt", "destination_folder": str(destination)}))
    assert saved["saved_path"] == str(target) and target.read_text(encoding="utf-8") == "contenido"
    receipt = next(item for item in _effects(session_id) if item["call_id"] == "call-d1")
    assert receipt["undo"]["available"] is True and receipt["undo"]["kind"] == "delete"

    assert _undo(session_id, "call-d1")["undone"] is True
    assert not target.exists()
    assert (store.drafts_dir(session_id) / "borrador.txt").is_file()


def test_drafts_save_overwrite_undo_restores_the_destination(store):
    session_id = store.create_session("provider", "model", "Undo")["id"]
    _draft(store, session_id, "nuevo")
    destination = store.base_dir / "entregas"
    destination.mkdir()
    target = destination / "borrador.txt"
    target.write_text("original", encoding="utf-8")

    _run(session_id, "call-d2", "drafts_save",
         {"name": "borrador.txt", "destination_folder": str(destination), "overwrite": True})
    assert target.read_text(encoding="utf-8") == "nuevo"

    assert _undo(session_id, "call-d2")["undone"] is True
    assert target.read_text(encoding="utf-8") == "original"


def test_prune_removes_expired_and_excess_snapshots(tmp_path):
    journal = undo_journal.UndoJournal(tmp_path)
    now = time.time()
    for name, age, size in (("viejo", 8 * 86400, 10), ("a", 300, 10), ("b", 200, 10), ("c", 100, 10)):
        directory = tmp_path / "undo" / name
        directory.mkdir(parents=True)
        (directory / "before").write_bytes(b"x" * size)
        os.utime(directory, (now - age, now - age))

    removed = journal.prune(max_bytes=15)

    assert set(removed) == {"viejo", "a", "b"}
    assert not (tmp_path / "undo" / "viejo").exists()
    assert not (tmp_path / "undo" / "a").exists()
    assert not (tmp_path / "undo" / "b").exists()
    assert (tmp_path / "undo" / "c").is_dir()


def _claim_write(store: agent.AgentStore, call_id: str, path: Path, *, snapshot: bool = True) -> None:
    outcome, record = store.dispatch_claim("s1", call_id, "fs_write", {"path": str(path)}, None)
    assert outcome == "new"
    resources = [{"path": str(path), "sha256": _sha(path)}] if snapshot else [{"path": str(path)}]
    store.undo_prepare("s1", call_id, str(record["op_id"]), "fs_write", resources)


def test_restart_reconciles_an_uncertain_write_that_finished(store, tmp_path, monkeypatch):
    target = tmp_path / "terminado.txt"
    target.write_text("antes", encoding="utf-8")
    _claim_write(store, "recon", target)
    target.write_text("después", encoding="utf-8")
    record = store.get_dispatch("s1", "recon")
    store.undo_finish("s1", "recon", str(record["op_id"]))

    reloaded = agent.AgentStore(tmp_path)
    record = reloaded.get_dispatch("s1", "recon")
    assert record["status"] == "succeeded"
    assert json.loads(record["result"])["recovered"] is True
    assert record["undo"]["available"] is True
    monkeypatch.setattr(agent, "get_agent_store", lambda: reloaded)
    [receipt] = agent_internal.HANDLERS["agent_internal_effects"]({"session_id": "s1"})["dispatches"]
    assert receipt["recovered"] is True and receipt["undo"]["available"] is True
    assert reloaded.undo_effect("s1", "recon")["undone"] is True
    assert target.read_text(encoding="utf-8") == "antes"


def test_restart_disables_undo_without_a_verified_result(store, tmp_path):
    target = tmp_path / "sin-confirmar.txt"
    target.write_text("antes", encoding="utf-8")
    _claim_write(store, "unverified", target)

    reloaded = agent.AgentStore(tmp_path)
    record = reloaded.get_dispatch("s1", "unverified")
    assert record["status"] == "uncertain"
    assert record["undo"]["available"] is False
    assert "sin confirmar" in record["undo"]["reason"]
    with pytest.raises(ValueError, match="sin confirmar"):
        reloaded.undo_effect("s1", "unverified")


def test_restart_disables_undo_when_the_file_changed_after_the_write(store, tmp_path):
    target = tmp_path / "cambiado.txt"
    target.write_text("antes", encoding="utf-8")
    _claim_write(store, "changed", target)
    target.write_text("del agente", encoding="utf-8")
    record = store.get_dispatch("s1", "changed")
    store.undo_finish("s1", "changed", str(record["op_id"]))
    target.write_text("externo", encoding="utf-8")

    reloaded = agent.AgentStore(tmp_path)
    record = reloaded.get_dispatch("s1", "changed")
    assert record["status"] == "uncertain"
    assert record["undo"]["available"] is False
    assert "no coincide" in record["undo"]["reason"]


def test_restart_prunes_old_snapshots_and_disables_their_undo(store, tmp_path):
    target = tmp_path / "caducado.txt"
    target.write_text("antes", encoding="utf-8")
    _claim_write(store, "pruned", target)
    target.write_text("después", encoding="utf-8")
    record = store.get_dispatch("s1", "pruned")
    store.undo_finish("s1", "pruned", str(record["op_id"]))
    store.dispatch_finish("s1", "pruned", str(record["op_id"]), "succeeded", "{}")
    directory = Path(store.get_dispatch("s1", "pruned")["undo"]["dir"])
    old = time.time() - 8 * 86400
    os.utime(directory, (old, old))

    reloaded = agent.AgentStore(tmp_path)
    assert not directory.exists()
    record = reloaded.get_dispatch("s1", "pruned")
    assert record["status"] == "succeeded"
    assert record["undo"]["available"] is False
    assert record["undo"]["reason"] == "La copia de seguridad expiró"
