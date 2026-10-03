import json
import threading

import pytest

from backend.core.flows import agent, agent_chat
from backend.core.ipc_catalog import ORCHESTRATABLE_METHODS, backend_methods


def _store(tmp_path):
    return agent.AgentStore(tmp_path)


def test_session_lifecycle(tmp_path):
    store = _store(tmp_path)
    s = store.create_session("ollama", "llama3.1", "Prueba")
    assert store.get_session(s["id"])["model"] == "llama3.1"
    assert [x["id"] for x in store.list_sessions()] == [s["id"]]
    store.append_message(s["id"], {"role": "user", "content": "hola"})
    msgs = store.messages(s["id"])
    assert msgs[0]["content"] == "hola" and msgs[0]["ts"] > 0
    # recarga desde disco
    assert _store(tmp_path).messages(s["id"])[0]["content"] == "hola"
    assert store.delete_session(s["id"]) is True
    assert _store(tmp_path).list_sessions() == []
    assert store.messages(s["id"]) == []


def test_gated_methods_exclude_readonly_and_denied():
    gated = set(agent_chat.gated_methods())
    safe = set(ORCHESTRATABLE_METHODS)
    assert gated.isdisjoint(safe)
    assert gated <= set(backend_methods())
    for banned in ("ai_provider_save", "flows_connection_token_put", "db_clear"):
        assert banned not in gated
    # hay métodos con efectos en el catálogo que sí quedan tras la puerta
    assert len(gated) > 0


def test_tool_specs_cover_readonly_and_gated():
    specs = agent_chat.tool_specs()
    by_name = {s["name"]: s for s in specs}
    assert by_name[sorted(ORCHESTRATABLE_METHODS)[0]]["gated"] is False
    assert by_name[agent_chat.gated_methods()[0]]["gated"] is True


def test_approval_flow(tmp_path):
    store = _store(tmp_path)
    s = store.create_session("ollama", "m", "t")
    call = {"id": "c1", "name": "flujos_x", "params": {"a": 1}}
    ap = store.create_approval(s["id"], call)
    assert store.pending_approvals(s["id"])[0]["method"] == "flujos_x"
    decided = store.decide_approval(ap["id"], True)
    assert decided["status"] == "approved" and decided["decided_at"]
    assert store.decide_approval(ap["id"], True) is None  # no doble decisión
    assert store.pending_approvals(s["id"]) == []


def test_update_tool_call(tmp_path):
    store = _store(tmp_path)
    s = store.create_session("ollama", "m", "t")
    store.append_message(
        s["id"], {"role": "assistant", "content": "", "tool_calls": [{"id": "c9", "name": "x", "status": "queued"}]}
    )
    store.update_tool_call(s["id"], "c9", "done", "resultado")
    call = store.messages(s["id"])[0]["tool_calls"][0]
    assert call["status"] == "done" and call["result"] == "resultado"


def _fake_runner(tmp_path, monkeypatch, replies):
    store = _store(tmp_path)
    executed = []
    monkeypatch.setattr(
        agent,
        "chat",
        lambda provider, model, messages: replies.pop(0) if replies else {"text": "fin", "calls": []},
    )
    runner = agent.AgentRunner(store, lambda name: lambda params: executed.append((name, params)) or {"ok": True})
    return store, runner, executed


def test_turn_runs_safe_tool_then_answers(tmp_path, monkeypatch):
    safe_method = sorted(ORCHESTRATABLE_METHODS)[0]
    store, runner, executed = _fake_runner(
        tmp_path,
        monkeypatch,
        [
            {"text": "consulto", "calls": [{"id": "t1", "name": safe_method, "params": {}}]},
            {"text": "respuesta final", "calls": []},
        ],
    )
    s = store.create_session("ollama", "m", "t")
    runner._run_loop(s["id"])
    assert executed == [(safe_method, {})]
    roles = [m["role"] for m in store.messages(s["id"])]
    assert roles == ["assistant", "tool_result", "assistant"]
    assert store.messages(s["id"])[-1]["content"] == "respuesta final"
    assert store.pending_approvals(s["id"]) == []


def test_turn_pauses_on_gated_tool_and_decide_resumes(tmp_path, monkeypatch):
    gated = agent_chat.gated_methods()[0]
    store, runner, executed = _fake_runner(
        tmp_path,
        monkeypatch,
        [
            {"text": "", "calls": [{"id": "g1", "name": gated, "params": {"k": 1}}]},
            {"text": "hecho", "calls": []},
        ],
    )
    s = store.create_session("ollama", "m", "t")
    runner._run_loop(s["id"])
    assert executed == []  # no ejecutó nada todavía
    pending = store.pending_approvals(s["id"])
    assert len(pending) == 1 and pending[0]["method"] == gated

    # no reanuda por hilo: llamamos decide() que ejecuta la tool aprobada
    monkeypatch.setattr(runner, "_spawn", lambda sid, name: runner._run_loop(sid))
    runner.decide(pending[0]["id"], True)
    assert executed == [(gated, {"k": 1})]
    msgs = store.messages(s["id"])
    assert msgs[-1]["content"] == "hecho"
    tool_call = next(c for m in msgs for c in (m.get("tool_calls") or []))
    assert tool_call["status"] == "done"


def test_deny_appends_denied_result_and_resumes(tmp_path, monkeypatch):
    gated = agent_chat.gated_methods()[0]
    store, runner, executed = _fake_runner(
        tmp_path,
        monkeypatch,
        [
            {"text": "", "calls": [{"id": "g1", "name": gated, "params": {}}]},
            {"text": "entendido", "calls": []},
        ],
    )
    s = store.create_session("ollama", "m", "t")
    runner._run_loop(s["id"])
    pending = store.pending_approvals(s["id"])
    monkeypatch.setattr(runner, "_spawn", lambda sid, name: runner._run_loop(sid))
    runner.decide(pending[0]["id"], False)
    assert executed == []
    msgs = store.messages(s["id"])
    result_msg = next(m for m in msgs if m["role"] == "tool_result")
    assert "rechaz" in result_msg["content"]
    assert msgs[-1]["content"] == "entendido"


def test_openai_wire_and_parse():
    msgs = [
        {"role": "user", "content": "hola"},
        {
            "role": "assistant",
            "content": "un momento",
            "tool_calls": [{"id": "c1", "name": "m1", "params": {"a": 2}}],
        },
        {"role": "tool_result", "tool_use_id": "c1", "content": "{}"},
    ]
    wire = agent_chat._openai_wire(msgs, None)
    assert wire[0]["role"] == "system"
    assert wire[1] == {"role": "user", "content": "hola"}
    assert wire[2]["tool_calls"][0]["function"]["name"] == "m1"
    assert json.loads(wire[2]["tool_calls"][0]["function"]["arguments"]) == {"a": 2}
    assert wire[3] == {"role": "tool", "tool_call_id": "c1", "content": "{}"}


def test_anthropic_wire_groups_tool_results():
    msgs = [
        {"role": "user", "content": "hola"},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "c1", "name": "m1", "params": {}}]},
        {"role": "tool_result", "tool_use_id": "c1", "content": "{}"},
        {"role": "assistant", "content": "listo"},
    ]
    wire = agent_chat._anthropic_wire(msgs)
    assert wire[0] == {"role": "user", "content": "hola"}
    assert wire[1]["role"] == "assistant" and wire[1]["content"][0]["type"] == "tool_use"
    assert wire[2]["role"] == "user" and wire[2]["content"][0]["type"] == "tool_result"
    assert wire[3] == {"role": "assistant", "content": [{"type": "text", "text": "listo"}]}


def test_chat_requires_configured_provider(tmp_path, monkeypatch):
    monkeypatch.setattr(agent_chat.ai_providers, "user_data_path", lambda rel: tmp_path / rel)
    with pytest.raises(ValueError, match="API key"):
        agent_chat.chat("openai", "gpt-4o-mini", [])
    # ollama no exige clave pero sí alcanzable; forzamos red falsa
    seen = {}

    def fake_post(url, headers, payload):
        seen["url"] = url
        return {"choices": [{"message": {"content": "ok", "tool_calls": []}}]}

    monkeypatch.setattr(agent_chat, "_post_json", fake_post)
    out = agent_chat.chat("ollama", "llama3.1", [{"role": "user", "content": "hola"}])
    assert out["text"] == "ok"
    assert seen["url"] == "http://127.0.0.1:11434/v1/chat/completions"


def test_get_agent_runner_no_deadlock(tmp_path, monkeypatch):
    """_store_lock guarda ambos singletons: get_agent_runner llama a get_agent_store
    bajo el mismo lock; con un Lock() normal se autobloquea en el primer acceso."""
    monkeypatch.setattr(agent, "user_data_path", lambda rel: tmp_path / rel)
    monkeypatch.setattr(agent, "_store_singleton", None)
    monkeypatch.setattr(agent, "_runner_singleton", None)
    done = []
    thread = threading.Thread(target=lambda: done.append(agent.get_agent_runner()), daemon=True)
    thread.start()
    thread.join(timeout=5)
    assert done, "get_agent_runner quedó bloqueado por _store_lock"


def test_first_user_message_titles_session(tmp_path):
    store = _store(tmp_path)
    s = store.create_session("ollama", "m", "")
    assert s["title"] == "Conversación"
    store.append_message(s["id"], {"role": "user", "content": "  lista mis formatos  "})
    assert store.get_session(s["id"])["title"] == "lista mis formatos"
    store.append_message(s["id"], {"role": "user", "content": "otro"})
    assert store.get_session(s["id"])["title"] == "lista mis formatos"  # no renombra
