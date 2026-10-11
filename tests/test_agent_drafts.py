"""Borradores del agente: salidas internas por conversación y guardado aprobado."""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from backend.core.agent import agent
from backend.handlers import agent_internal


@pytest.fixture()
def store(tmp_path, monkeypatch):
    instance = agent.AgentStore(tmp_path / "agent")
    monkeypatch.setattr(agent, "get_agent_store", lambda: instance)
    return instance


@pytest.fixture()
def calls(store, monkeypatch):
    seen: list[tuple[str, dict]] = []

    def handler_for(name):
        def handler(params):
            seen.append((name, params))
            output = params.get("output_path")
            if output:
                Path(output).write_bytes(b"%PDF sellado")
                return {"saved_path": output}
            return {"ok": True}
        return handler

    monkeypatch.setattr(agent, "get_agent_runner", lambda: agent.AgentRunner(store, handler_for))
    return seen


def _call(name, params):
    return agent_internal.HANDLERS[name](params)


def _approved_run(call_id, name, params, session_id="s1"):
    approval = _call("agent_internal_approval_ensure", {
        "session_id": session_id, "call_id": call_id, "method": name, "params": params,
    })["approval"]
    _call("agent_internal_approval_decide", {"approval_id": approval["id"], "approve": True})
    out = _call("agent_internal_dispatch", {
        "session_id": session_id, "call_id": call_id, "name": name, "params": params, "approval_id": approval["id"],
    })
    deadline = time.monotonic() + 10
    while out["result"] is None and time.monotonic() < deadline:
        time.sleep(0.02)
        out = _call("agent_internal_dispatch_result", {"session_id": session_id, "call_id": call_id})
    return json.loads(out["result"])


def _read(call_id, name, params, session_id="s1"):
    out = _call("agent_internal_dispatch", {"session_id": session_id, "call_id": call_id, "name": name, "params": params})
    deadline = time.monotonic() + 10
    while out["result"] is None and time.monotonic() < deadline:
        time.sleep(0.02)
        out = _call("agent_internal_dispatch_result", {"session_id": session_id, "call_id": call_id})
    return json.loads(out["result"])


@pytest.fixture()
def pdf(tmp_path, store):
    path = tmp_path / "trabajos" / "informe.pdf"
    path.parent.mkdir()
    path.write_bytes(b"%PDF original")
    _call("agent_internal_grants_add", {"session_id": "s1", "paths": [str(path)]})
    return path


def test_output_name_is_written_in_the_conversation_drafts(store, calls, pdf):
    result = _approved_run("c1", "sellador_apply", {"pdf_path": str(pdf), "output_path": "informe-sellado.pdf"})
    draft = store.drafts_dir("s1") / "informe-sellado.pdf"
    assert result == {"saved_path": str(draft)}
    assert draft.read_bytes() == b"%PDF sellado"
    assert pdf.read_bytes() == b"%PDF original"
    listed = _read("c2", "drafts_list", {})
    assert [d["name"] for d in listed["drafts"]] == ["informe-sellado.pdf"]


@pytest.mark.parametrize("output", ["C:/Users/Public/fuera.pdf", "..\\fuera.pdf", "sub/fuera.pdf", "CON.pdf"])
def test_outputs_outside_the_drafts_are_rejected(store, calls, pdf, output):
    result = _approved_run("c1", "sellador_apply", {"pdf_path": str(pdf), "output_path": output})
    assert result.get("error")
    assert calls == []


def test_a_draft_can_feed_another_tool(store, calls, pdf):
    _approved_run("c1", "sellador_apply", {"pdf_path": str(pdf), "output_path": "sellado.pdf"})
    draft = store.drafts_dir("s1") / "sellado.pdf"
    result = _approved_run("c2", "print_pdf", {"pdf_path": str(draft), "printer_name": "Prueba"})
    assert result == {"ok": True}
    assert calls[-1] == ("print_pdf", {"pdf_path": str(draft), "printer_name": "Prueba"})
    with pytest.raises(Exception, match="no está autorizado"):
        _approved_run("c3", "print_pdf", {"pdf_path": str(draft), "printer_name": "Prueba"}, session_id="s2")


def test_save_draft_needs_approval_and_never_overwrites_implicitly(store, calls, pdf, tmp_path):
    _approved_run("c1", "sellador_apply", {"pdf_path": str(pdf), "output_path": "sellado.pdf"})
    destination = tmp_path / "entregas"
    destination.mkdir()
    unapproved = _read("c2", "drafts_save", {"name": "sellado.pdf", "destination_folder": str(destination)})
    assert unapproved.get("error") and not (destination / "sellado.pdf").exists()

    saved = _approved_run("c3", "drafts_save", {"name": "sellado.pdf", "destination_folder": str(destination)})
    assert saved["saved_path"] == str(destination / "sellado.pdf") and saved["replaced"] is False
    again = _approved_run("c4", "drafts_save", {"name": "sellado.pdf", "destination_folder": str(destination)})
    assert "ya existe" in again["error"]
    replaced = _approved_run("c5", "drafts_save",
                             {"name": "sellado.pdf", "destination_folder": str(destination), "overwrite": True})
    assert replaced["replaced"] is True
    missing = _approved_run("c6", "drafts_save", {"name": "sellado.pdf", "destination_folder": str(tmp_path / "no")})
    assert "no existe" in missing["error"]
    escape = _approved_run("c7", "drafts_save", {"name": "..\\..\\grants.json", "destination_folder": str(destination)})
    assert escape.get("error")
