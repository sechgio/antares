import json

import pytest

from backend.core.agent import agent, agent_chat, subagent
from backend.core.agent.cancel import _CancelEvent
from tests.agent_store_seed import seed_session


def _session(tmp_path):
    store = agent.AgentStore(tmp_path)
    session = seed_session(store, title="Prueba")
    return store, session


def _profile(**overrides):
    return {
        "id": "perfil-1",
        "name": "Investigador",
        "instructions": "Consulta el catálogo y resume.",
        "tools": ["canvas_list"],
        **overrides,
    }


def _call(session, **overrides):
    return {
        "id": "c1",
        "name": subagent.TOOL_NAME,
        "params": {"agent": "Investigador", "task": "¿Qué plantillas hay?"},
        "session_id": session["id"],
        "subagent": _profile(),
        **overrides,
    }


def test_subagent_emite_inicio_paso_y_fin(monkeypatch):
    replies = [
        {"text": "", "calls": [{"id": "t1", "name": "canvas_list", "params": {}}]},
        {"text": "Hay tres plantillas.", "calls": []},
    ]
    monkeypatch.setattr(agent_chat, "chat", lambda *args, **kwargs: replies.pop(0))
    events = []

    receipt = subagent.run(
        provider="local",
        model="prueba",
        agent=_profile(),
        task="¿Qué plantillas hay?",
        tools=[{"name": "canvas_list"}],
        execute=lambda name, params: json.dumps({"documents": []}),
        on_event=events.append,
    )

    assert receipt["status"] == "done"
    assert [event["event"] for event in events] == ["start", "step", "finish"]
    assert events[0]["name"] == "Investigador" and events[0]["status"] == "running"
    assert events[0]["task"] == "¿Qué plantillas hay?"
    assert events[1]["tool"] == "canvas_list" and events[1]["status"] == "done"
    assert events[2]["status"] == "done" and events[2]["steps"] == 1


def test_subagent_identifica_cada_llamada_en_el_progreso(tmp_path, monkeypatch):
    store, session = _session(tmp_path)
    monkeypatch.setattr(agent_chat, "chat", lambda *args, **kwargs: {"text": "Listo", "calls": []})
    sent = []

    def capture(session_id, source, event, **fields):
        sent.append({"session_id": session_id, "source": source, "event": event, **fields})

    monkeypatch.setattr(agent.agent_progress, "emit", capture)
    runner = agent.AgentRunner(store, lambda name: lambda params: {})

    runner._execute(_call(session, id="c1"), None)
    runner._execute(_call(session, id="c2"), None)

    assert [event["id"] for event in sent if event["event"] == "start"] == ["c1", "c2"]


def test_subagent_emite_error_si_el_proveedor_falla(monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("proveedor caído")

    monkeypatch.setattr(agent_chat, "chat", broken)
    events = []

    with pytest.raises(RuntimeError, match="proveedor caído"):
        subagent.run(
            provider="local",
            model="prueba",
            agent=_profile(),
            task="Investiga",
            tools=[],
            execute=lambda name, params: "{}",
            on_event=events.append,
        )

    assert events[0]["event"] == "start"
    assert events[-1]["event"] == "error"
    assert "proveedor caído" in events[-1]["detail"]


def test_subagent_emite_progreso_por_notificacion_y_token(tmp_path, monkeypatch):
    store, session = _session(tmp_path)
    replies = [
        {"text": "", "calls": [{"id": "t1", "name": "canvas_list", "params": {}}]},
        {"text": "Listo", "calls": []},
    ]
    monkeypatch.setattr(agent_chat, "chat", lambda *args, **kwargs: replies.pop(0))
    sent = []

    def capture(session_id, source, event, **fields):
        sent.append({"session_id": session_id, "source": source, "event": event, **fields})

    monkeypatch.setattr(agent.agent_progress, "emit", capture)
    runner = agent.AgentRunner(store, lambda name: lambda params: {"documents": []})
    token = _CancelEvent()

    runner._execute(_call(session), token)

    assert sent[0]["source"] == "subagent" and sent[0]["event"] == "start"
    assert sent[0]["session_id"] == session["id"]
    assert sent[0]["id"] == "c1"
    assert sent[-1]["event"] == "finish" and sent[-1]["status"] == "done"
    assert "inicio" in token.progress and "fin" in token.progress
