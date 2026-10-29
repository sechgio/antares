from __future__ import annotations

import json
import time

import pytest

from backend.core.agent import agent, agent_tools
from backend.handlers import agent_internal


@pytest.fixture()
def dispatch(tmp_path, monkeypatch):
    store = agent.AgentStore(tmp_path / "agent")
    runner = agent.AgentRunner(store, lambda _: None)
    monkeypatch.setattr(agent, "get_agent_store", lambda: store)
    monkeypatch.setattr(agent, "get_agent_runner", lambda: runner)

    def run(call_id: str, name: str, params: dict) -> dict:
        call = {"session_id": "s1", "call_id": call_id, "name": name, "params": params}
        out = agent_internal.HANDLERS["agent_internal_dispatch"](call)
        deadline = time.monotonic() + 10
        while out["result"] is None and time.monotonic() < deadline:
            time.sleep(0.02)
            out = agent_internal.HANDLERS["agent_internal_dispatch_result"]({"session_id": "s1", "call_id": call_id})
        return json.loads(out["result"])

    run.store = store  # type: ignore[attr-defined]
    return run


def test_panel_show_persists_with_its_call_and_answers_once(dispatch, tmp_path):
    result = dispatch("ask-1", "panel_show", {"type": "choice", "props": {"prompt": "¿Formato?", "options": ["PDF", "Excel"]}})
    panel_id = result["panel"]["id"]
    assert result["panel"] == {"id": panel_id, "type": "choice"}
    assert "panel_show" in agent_tools.READ_TOOLS
    [panel] = agent_internal.HANDLERS["agent_internal_artifacts"]({"session_id": "s1"})["panels"]
    assert panel["call_id"] == "ask-1" and panel["status"] == "open" and panel["props"]["options"] == ["PDF", "Excel"]
    respond = agent_internal.HANDLERS["agent_panel_respond"]
    out = respond({"session_id": "s1", "panel_id": panel_id, "response": {"choice": "Excel"}})
    assert out["message"] == f"[panel:{panel_id}] Opción elegida: Excel"
    with pytest.raises(Exception, match="ya no está activo"):
        respond({"session_id": "s1", "panel_id": panel_id, "response": {"choice": "PDF"}})
    [reloaded] = agent.AgentStore(tmp_path / "agent").panels_for("s1")
    assert reloaded["status"] == "answered" and reloaded["response"] == {"choice": "Excel"}


def test_form_response_lists_values_and_other_sessions_are_isolated(dispatch):
    panel_id = dispatch("form-1", "panel_show", {"type": "form", "props": {"fields": [{"name": "zona", "label": "Zona"}]}})["panel"]["id"]
    respond = agent_internal.HANDLERS["agent_panel_respond"]
    with pytest.raises(Exception, match="ya no está activo"):
        respond({"session_id": "other", "panel_id": panel_id, "response": {"values": {"zona": "Norte"}}})
    with pytest.raises(Exception, match="necesita valores"):
        respond({"session_id": "s1", "panel_id": panel_id, "response": {}})
    out = respond({"session_id": "s1", "panel_id": panel_id, "response": {"values": {"zona": "Norte", "urgente": True}}})
    assert out["message"] == f"[panel:{panel_id}] Formulario enviado:\n- zona: Norte\n- urgente: true"


def test_invalid_panels_are_rejected_and_tables_take_no_answers(dispatch):
    assert "error" in dispatch("bad-1", "panel_show", {"type": "page", "props": {}})
    assert "error" in dispatch("bad-2", "panel_show", {"type": "choice", "props": {"text": "x" * 210_000}})
    panel_id = dispatch("table-1", "panel_show", {"type": "table", "props": {"columns": ["OT"], "rows": [[1]]}})["panel"]["id"]
    with pytest.raises(Exception, match="no admite respuestas"):
        agent_internal.HANDLERS["agent_panel_respond"]({"session_id": "s1", "panel_id": panel_id, "response": {"choice": "x"}})
    assert [panel["type"] for panel in dispatch.store.panels_for("s1")] == ["table"]


def test_page_create_emits_a_page_panel(dispatch):
    result = dispatch("page-1", "page_create", {"title": "Avance", "html": "<h1>Avance</h1>", "script": ""})
    [panel] = dispatch.store.panels_for("s1")
    assert result["panel"] == {"id": panel["id"], "type": "page"}
    assert panel["props"] == {"artifact_id": result["artifact"]["id"], "sha256": result["artifact"]["files"][0]["sha256"],
                              "title": "Avance"}
