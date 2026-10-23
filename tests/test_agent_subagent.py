import json
import time
from pathlib import Path

import pytest

from backend.core.agent import agent, agent_chat, subagent
from backend.core.agent.cancel import RunCancelled, _CancelEvent
from backend.handlers import agent_internal


def _session(tmp_path):
    store = agent.AgentStore(tmp_path)
    session = store.create_session("ollama", "llama3.1", "Prueba")
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


def test_subagent_ejecuta_lecturas_y_devuelve_traza(tmp_path, monkeypatch):
    store, session = _session(tmp_path)
    replies = [
        {"text": "", "calls": [{"id": "t1", "name": "canvas_list", "params": {"include": "all"}}]},
        {"text": "Hay tres plantillas.", "calls": []},
    ]
    offered = []

    def fake_chat(provider, model, messages, system=None, tools=None, **kwargs):
        offered.append([spec["name"] for spec in tools or []])
        return replies.pop(0)

    executed = []

    def handler(name):
        return lambda params: executed.append((name, params)) or {"documents": ["a", "b"]}

    monkeypatch.setattr(agent_chat, "chat", fake_chat)
    runner = agent.AgentRunner(store, handler)
    receipt = json.loads(runner._execute(_call(session), None))

    assert receipt["status"] == "done"
    assert receipt["text"] == "Hay tres plantillas."
    assert receipt["agent"] == {"id": "perfil-1", "name": "Investigador"}
    assert receipt["steps"] == [{"name": "canvas_list", "status": "done"}]
    assert executed == [("canvas_list", {"include": "all"})]
    assert offered[0] == ["canvas_list"]


def test_subagente_no_ejecuta_efectos_ni_se_ofrece_a_si_mismo(tmp_path, monkeypatch):
    store, session = _session(tmp_path)
    replies = [
        {"text": "", "calls": [{"id": "t1", "name": "db_clear", "params": {}}]},
        {"text": "No puedo borrar datos.", "calls": []},
    ]
    monkeypatch.setattr(agent_chat, "chat", lambda *args, **kwargs: replies.pop(0))
    executed = []
    runner = agent.AgentRunner(store, lambda name: lambda params: executed.append(name) or {})
    receipt = json.loads(runner._execute(_call(session), None))

    assert executed == []
    assert receipt["steps"] == [{
        "name": "db_clear",
        "status": "failed",
        "detail": "Herramienta no disponible para el subagente: db_clear",
    }]
    allowed = subagent.allowed_tool_names(["db_clear", "canvas_save", subagent.TOOL_NAME, "canvas_list"], None)
    assert allowed == ["canvas_list"]
    assert "memory_remember" not in subagent.allowed_tool_names(None, None)
    assert "procedure_learn" not in subagent.allowed_tool_names(None, None)


def test_subagente_respeta_herramientas_habilitadas_en_la_conversacion(tmp_path, monkeypatch):
    store, session = _session(tmp_path)
    monkeypatch.setattr(agent_chat, "chat", lambda *args, **kwargs: {"text": "sin herramientas", "calls": []})
    runner = agent.AgentRunner(store, lambda name: lambda params: {})
    receipt = json.loads(runner._execute(_call(session, subagent=_profile(enabled=[])), None))

    assert receipt["status"] == "done"
    assert subagent.allowed_tool_names(["canvas_list"], []) == []


def test_subagente_corta_al_llegar_al_limite(tmp_path, monkeypatch):
    store, session = _session(tmp_path)
    monkeypatch.setattr(
        agent_chat,
        "chat",
        lambda *args, **kwargs: {"text": "", "calls": [{"id": "t", "name": "canvas_list", "params": {}}]},
    )
    runner = agent.AgentRunner(store, lambda name: lambda params: {"ok": True})
    receipt = json.loads(runner._execute(_call(session), None))

    assert receipt["status"] == "limit"
    assert len(receipt["steps"]) == subagent.MAX_STEPS
    assert len(json.dumps(receipt, ensure_ascii=False)) <= subagent.MAX_RECEIPT_CHARS

def test_dispatch_exige_el_perfil_resuelto_por_electron():
    result = agent_internal._dispatch({"session_id": "s", "call_id": "c", "name": subagent.TOOL_NAME, "params": {}})
    assert json.loads(result["result"])["error"] == "El agente indicado no está disponible para delegar"


def test_dispatch_reenvia_el_perfil_y_devuelve_el_recibo(tmp_path, monkeypatch):
    store, session = _session(tmp_path)
    seen = {}

    class Runner:
        def _execute(self, call, token=None):
            seen.update(call)
            return json.dumps({"agent": {"name": "Investigador"}, "status": "done", "text": "ok", "steps": [], "ms": 1})

    monkeypatch.setattr(agent_internal, "_store", lambda: store)
    monkeypatch.setattr(agent_internal._agent, "get_agent_runner", lambda: Runner())
    request = {
        "session_id": session["id"],
        "call_id": "c1",
        "name": subagent.TOOL_NAME,
        "params": {"agent": "Investigador", "task": "Busca documentos"},
        "context": {"subagent": _profile(enabled=["canvas_list"])},
    }
    out = agent_internal._dispatch(request)
    assert out["result"] is None and out["dispatch"]["status"] == "running"
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        out = agent_internal._dispatch_result({"session_id": session["id"], "call_id": "c1"})
        if out["dispatch"]["status"] != "running":
            break
        time.sleep(0.02)

    assert seen["subagent"]["name"] == "Investigador"
    assert seen["subagent"]["enabled"] == ["canvas_list"]
    assert json.loads(out["result"])["text"] == "ok"


@pytest.mark.parametrize("status", ["done", "empty", "limit"])
def test_recibo_siempre_es_json_serializable(status):
    receipt = subagent._trim_receipt({"status": status, "text": "x" * 10_000, "steps": [], "ms": 1})
    assert len(json.dumps(receipt, ensure_ascii=False)) <= subagent.MAX_RECEIPT_CHARS


def test_subagent_discards_final_reply_after_cancellation(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store, session = _session(tmp_path)
    token = _CancelEvent()

    def chat(*args: object, **kwargs: object) -> dict[str, object]:
        token.cancel()
        return {"text": "Respuesta que llegó después de detener", "calls": []}

    monkeypatch.setattr(agent_chat, "chat", chat)
    runner = agent.AgentRunner(store, lambda name: lambda params: {})
    with pytest.raises(RunCancelled):
        runner._execute(_call(session), token)


def test_subagent_discards_limit_receipt_if_cancelled_in_the_last_tool(monkeypatch: pytest.MonkeyPatch) -> None:
    token = _CancelEvent()
    executed = []
    monkeypatch.setattr(agent_chat, "chat", lambda *args, **kwargs: {
        "text": "En curso", "calls": [{"id": "read", "name": "canvas_list", "params": {}}],
    })

    def execute(name: str, params: dict[str, object]) -> str:
        executed.append(name)
        if len(executed) == subagent.MAX_STEPS:
            token.cancel()
        return "{}"

    with pytest.raises(RunCancelled):
        subagent.run(provider="faux", model="current", agent=_profile(), task="Lee datos",
                     tools=[{"name": "canvas_list"}], execute=execute, cancelled=lambda: token.cancelled)
    assert len(executed) == subagent.MAX_STEPS
