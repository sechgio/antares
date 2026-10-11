"""Archivos nombrados por el humano: concesión, revalidación y aprobación vinculada."""

from __future__ import annotations

import json
import os
import time

import pytest

from backend.core.agent import agent
from backend.handlers import agent_internal


@pytest.fixture()
def store(tmp_path, monkeypatch):
    instance = agent.AgentStore(tmp_path / "agent")
    monkeypatch.setattr(agent, "get_agent_store", lambda: instance)
    return instance


@pytest.fixture()
def executed(store, monkeypatch):
    calls: list[dict] = []
    runner = agent.AgentRunner(store, lambda name: lambda params: calls.append(params) or {"ok": True})
    monkeypatch.setattr(agent, "get_agent_runner", lambda: runner)
    monkeypatch.setattr(agent_internal._agent_chat, "gated_methods", lambda: ["sellador_inspect_pdf"])
    return calls


@pytest.fixture()
def pdf(tmp_path):
    path = tmp_path / "trabajos" / "informe.pdf"
    path.parent.mkdir()
    path.write_bytes(b"%PDF-1.4 original")
    return path


def _call(name, params):
    return agent_internal.HANDLERS[name](params)


def _grant(paths, session_id="s1"):
    return _call("agent_internal_grants_add", {"session_id": session_id, "paths": [str(p) for p in paths]})


def _approve(call_id, params, session_id="s1"):
    approval = _call("agent_internal_approval_ensure", {
        "session_id": session_id, "call_id": call_id, "method": "sellador_inspect_pdf", "params": params,
    })["approval"]
    _call("agent_internal_approval_decide", {"approval_id": approval["id"], "approve": True})
    return approval["id"]


def _run(call_id, params, approval_id, session_id="s1"):
    out = _call("agent_internal_dispatch", {
        "session_id": session_id, "call_id": call_id, "name": "sellador_inspect_pdf",
        "params": params, "approval_id": approval_id,
    })
    if out["result"] is not None:
        return json.loads(out["result"])
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        result = _call("agent_internal_dispatch_result", {"session_id": session_id, "call_id": call_id})["result"]
        if result is not None:
            return json.loads(result)
        time.sleep(0.02)
    raise AssertionError("el dispatch no terminó")


def test_human_path_grants_read_of_that_file_only(store, executed, pdf, tmp_path):
    other = pdf.parent / "otro.pdf"
    other.write_bytes(b"%PDF otro")
    assert _grant([pdf])["granted"] == [os.path.realpath(pdf)]
    params = {"pdf_path": str(pdf)}
    assert _run("c1", params, _approve("c1", params)) == {"ok": True}
    assert executed == [params]

    lateral = {"pdf_path": str(other)}
    with pytest.raises(Exception, match="no está autorizado"):
        _approve("c2", lateral)
    assert len(executed) == 1


@pytest.mark.parametrize("make_path,reason", [
    (lambda pdf: pdf.parent, "carpeta"),
    (lambda pdf: pdf.parent / ".." / "trabajos" / "informe.pdf", "'..'"),
    (lambda pdf: "trabajos\\informe.pdf", "absoluta"),
    (lambda pdf: "\\\\servidor\\compartido\\informe.pdf", "red"),
    (lambda pdf: pdf.parent / "no-existe.pdf", "no existe"),
])
def test_folders_traversal_relative_network_and_missing_paths_are_not_granted(store, pdf, make_path, reason):
    result = _grant([make_path(pdf)])
    assert result["granted"] == []
    assert reason in result["rejected"][0]["reason"]
    assert store.grants_for("s1") == {}


def test_symlinks_are_not_granted(store, pdf, tmp_path):
    link = tmp_path / "enlace.pdf"
    try:
        link.symlink_to(pdf)
    except OSError:
        pytest.skip("el sistema no permite crear enlaces simbólicos")
    result = _grant([link])
    assert result["granted"] == [] and "enlaces" in result["rejected"][0]["reason"]


def test_model_invented_path_and_other_conversation_are_rejected(store, executed, pdf):
    _grant([pdf], session_id="s1")
    params = {"pdf_path": str(pdf)}
    with pytest.raises(Exception, match="no está autorizado"):
        _approve("c1", params, session_id="s2")
    forged = _run("c9", params, "aprobacion-falsa", session_id="s2")
    assert "no está autorizado" in forged["error"]
    assert executed == []


def test_substituted_file_is_rejected(store, executed, pdf):
    _grant([pdf])
    params = {"pdf_path": str(pdf)}
    approval_id = _approve("c1", params)
    replacement = pdf.with_name("nuevo.pdf")
    replacement.write_bytes(b"%PDF sustituto")
    pdf.unlink()
    replacement.rename(pdf)
    result = _run("c1", params, approval_id)
    assert "sustituido" in result["error"]
    assert executed == []


def test_changing_the_file_after_approval_invalidates_it(store, executed, pdf):
    _grant([pdf])
    params = {"pdf_path": str(pdf)}
    approval_id = _approve("c1", params)
    with pdf.open("ab") as handle:
        handle.write(b" editado")
    os.utime(pdf, ns=(time.time_ns(), time.time_ns() + 5_000_000_000))
    result = _run("c1", params, approval_id)
    assert "no coinciden" in result["error"]
    assert executed == []


def test_revoked_grants_block_execution(store, executed, pdf):
    _grant([pdf])
    params = {"pdf_path": str(pdf)}
    approval_id = _approve("c1", params)
    assert _call("agent_internal_grants_revoke", {"session_id": "s1"}) == {"revoked": 1}
    result = _run("c1", params, approval_id)
    assert "no está autorizado" in result["error"]
    assert executed == []


def test_grants_survive_restart_and_session_deletion_removes_them(store, pdf, tmp_path):
    _grant([pdf])
    reopened = agent.AgentStore(tmp_path / "agent")
    assert next(iter(reopened.grants_for("s1").values()))["path"] == os.path.realpath(pdf)
    reopened.delete_session("s1")
    assert agent.AgentStore(tmp_path / "agent").grants_for("s1") == {}


def test_grant_and_approval_methods_are_never_agent_tools():
    names = {spec["name"] for spec in agent_internal._agent_chat.tool_specs()}
    assert not {n for n in names if n.startswith("agent_")}
