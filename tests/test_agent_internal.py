"""Puente privado Electron→Python del agente nativo (``agent_internal_*``).

El runtime vive en Electron; estos handlers conservan en Python vault,
allowlist, lanes del scheduler, validación de rutas y aprobaciones. El
dispatch se reserva de forma atómica por ``(session_id, call_id)`` para que un
replay nunca repita un efecto cuyo resultado quedó incierto.
"""

import json
import threading
import time

import pytest

from backend.core.agent import agent
from backend.core.exceptions import NotFoundError, ValidationError
from backend.core.integrations import ai_providers, mcp_servers
from backend.handlers import agent_internal


@pytest.fixture()
def store(tmp_path, monkeypatch):
    instance = agent.AgentStore(tmp_path)
    monkeypatch.setattr(agent, "get_agent_store", lambda: instance)
    return instance


def _provider_info(provider, **config):
    return agent_internal.HANDLERS["agent_internal_provider"]({"provider": provider, **config})


def _dispatch(**params):
    return agent_internal.HANDLERS["agent_internal_dispatch"](params)


def _dispatch_result(call_id, session_id="s1"):
    return agent_internal.HANDLERS["agent_internal_dispatch_result"]({"session_id": session_id, "call_id": call_id})


def _wait_result(call_id, timeout=10, session_id="s1"):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        out = _dispatch_result(call_id, session_id)
        if out["result"] is not None:
            return out
        time.sleep(0.02)
    raise AssertionError(f"dispatch {call_id} no terminó")


def test_tools_list_projects_backend_and_mcp_kinds(monkeypatch):
    monkeypatch.setattr(mcp_servers, "list_servers", lambda: [{"id": "srv"}])
    monkeypatch.setattr(
        agent_internal._agent_chat,
        "tool_specs",
        lambda: [
            {"name": "flows_list", "gated": False},
            {"name": "db_export", "gated": True},
            {"name": mcp_servers.agent_tool_name("srv", "search"), "gated": True},
        ],
    )
    tools = agent_internal.HANDLERS["agent_internal_tools"]({})["tools"]
    by_name = {t["name"]: t for t in tools}
    assert by_name["flows_list"]["kind"] == "backend"
    assert by_name["db_export"]["kind"] == "backend"
    assert by_name[mcp_servers.agent_tool_name("srv", "search")]["kind"] == "mcp"


def test_provider_wire_base_url_per_style(monkeypatch):
    monkeypatch.setattr(ai_providers, "get_config", lambda provider: None)
    # Ollama sirve /v1/chat/completions: el wire base conserva el /v1.
    ollama = _provider_info("ollama")
    assert ollama["base_url"].endswith("/v1")
    assert ollama["auth_type"] == "none" and ollama["api_key"] is None
    assert ollama["style"] == "openai_chat"
    # OpenAI/OpenRouter conservan Chat Completions.
    for name in ("openai", "openrouter"):
        monkeypatch.setattr(ai_providers, "get_config", lambda p, k="sk-test": {"api_key": k})
        info = _provider_info(name)
        assert info["style"] == "openai_chat"
        assert info["base_url"].endswith("/v1") or info["base_url"].endswith("/api/v1")
        assert info["api_key"] == "sk-test"
    # Anthropic: el SDK añade /v1/messages, el wire base es la raíz.
    anthropic = _provider_info("anthropic")
    assert anthropic["style"] == "anthropic_messages"
    assert anthropic["base_url"] == "https://api.anthropic.com"
    assert anthropic["extra_headers"].get("anthropic-version")


def test_provider_requires_key_and_known_provider(monkeypatch):
    monkeypatch.setattr(ai_providers, "get_config", lambda provider: None)
    with pytest.raises(ValidationError):
        _provider_info("openai")
    with pytest.raises(ValidationError):
        _provider_info("proveedor-inexistente")


def test_approval_ensure_is_idempotent_per_call(store):
    params = {"session_id": "s1", "call_id": "c1", "method": "db_clear", "params": {}}
    first = agent_internal.HANDLERS["agent_internal_approval_ensure"](params)["approval"]
    again = agent_internal.HANDLERS["agent_internal_approval_ensure"](params)["approval"]
    assert first["id"] == again["id"]
    pending = agent_internal.HANDLERS["agent_internal_approvals_pending"]({"session_id": "s1"})["approvals"]
    assert [a["id"] for a in pending] == [first["id"]]
    decided = agent_internal.HANDLERS["agent_internal_approval_decide"](
        {"approval_id": first["id"], "approve": True}
    )["approval"]
    assert decided["status"] == "approved"
    # Una segunda decisión no cambia nada.
    with pytest.raises(ValidationError):
        agent_internal.HANDLERS["agent_internal_approval_decide"](
            {"approval_id": first["id"], "approve": False}
        )


def test_approvals_deny_session(store):
    store.create_approval("s1", {"id": "c1", "name": "db_clear", "params": {}})
    store.create_approval("s1", {"id": "c2", "name": "db_export", "params": {}})
    store.create_approval("s2", {"id": "c3", "name": "db_clear", "params": {}})
    denied = agent_internal.HANDLERS["agent_internal_approvals_deny_session"]({"session_id": "s1"})["denied"]
    assert len(denied) == 2
    remaining = agent_internal.HANDLERS["agent_internal_approvals_pending"]({"session_id": "s2"})["approvals"]
    assert len(remaining) == 1


def test_dispatch_dedup_never_reexecutes(store, monkeypatch):
    executed = []
    runner = agent.AgentRunner(store, lambda name: lambda params: executed.append(name) or {"ok": 1})
    monkeypatch.setattr(agent, "get_agent_runner", lambda: runner)
    monkeypatch.setattr(agent_internal, "ORCHESTRATABLE_METHODS", {"flows_list"})

    params = {"session_id": "s1", "call_id": "c1", "name": "flows_list", "params": {}}
    assert _dispatch(**params)["result"] is None  # arranca en segundo plano
    out = _wait_result("c1")
    assert json.loads(out["result"]) == {"ok": 1}
    # La repetición sirve lo persistido: no hay segunda ejecución.
    again = _dispatch(**params)
    assert json.loads(again["result"]) == {"ok": 1}
    assert executed == ["flows_list"]


def test_dispatch_gated_requires_bound_approved_approval(store, monkeypatch):
    executed = []
    runner = agent.AgentRunner(store, lambda name: lambda params: executed.append(name) or {"ok": 1})
    monkeypatch.setattr(agent, "get_agent_runner", lambda: runner)
    monkeypatch.setattr(agent_internal._agent_chat, "gated_methods", lambda: ["db_clear"])

    params = {"session_id": "s1", "call_id": "c1", "name": "db_clear", "params": {}}
    denied = json.loads(_dispatch(**params)["result"])
    assert denied.get("error")
    assert executed == []

    approval = agent_internal.HANDLERS["agent_internal_approval_ensure"](
        {"session_id": "s1", "call_id": "c1", "method": "db_clear", "params": {}}
    )["approval"]
    # La aprobación pendiente todavía no autoriza.
    still = json.loads(_dispatch(**{**params, "approval_id": approval["id"]})["result"])
    assert still.get("error")
    agent_internal.HANDLERS["agent_internal_approval_decide"](
        {"approval_id": approval["id"], "approve": True}
    )
    assert _dispatch(**{**params, "approval_id": approval["id"]})["result"] is None
    assert json.loads(_wait_result("c1")["result"]) == {"ok": 1}
    assert executed == ["db_clear"]


def test_dispatch_running_at_restart_becomes_uncertain(store, tmp_path):
    outcome, record = store.dispatch_claim("s1", "c9", "db_clear", {}, None)
    assert outcome == "new" and record["status"] == "running"
    reloaded = agent.AgentStore(tmp_path)
    record = reloaded.get_dispatch("s1", "c9")
    assert record["status"] == "uncertain"
    assert "incierto" in json.loads(record["result"])["error"]


def test_dispatch_rejects_forged_file_grants(store, monkeypatch):
    executed = []
    runner = agent.AgentRunner(store, lambda name: lambda params: executed.append(params) or {"ok": 1})
    monkeypatch.setattr(agent, "get_agent_runner", lambda: runner)
    monkeypatch.setattr(agent_internal, "ORCHESTRATABLE_METHODS", {"flows_list"})

    _dispatch(session_id="s1", call_id="c1", name="flows_list",
              params={"_file_grants": {"write": ["C:/otra"]}})
    result = json.loads(_wait_result("c1")["result"])
    assert "permisos" in result["error"]
    assert executed == []


def test_dispatch_result_unknown_and_cancel(store):
    with pytest.raises(NotFoundError):
        _dispatch_result("inexistente")
    out = agent_internal.HANDLERS["agent_internal_dispatch_cancel"]({"session_id": "s1", "call_id": "inexistente"})
    assert out == {"cancelled": False}


def _approve(session_id, call_id, method, params):
    approval = agent_internal.HANDLERS["agent_internal_approval_ensure"](
        {"session_id": session_id, "call_id": call_id, "method": method, "params": params}
    )["approval"]
    agent_internal.HANDLERS["agent_internal_approval_decide"]({"approval_id": approval["id"], "approve": True})
    return approval["id"]


def test_concurrent_dispatches_start_a_single_worker(store, monkeypatch):
    started = threading.Event()
    release = threading.Event()
    executed = []

    def slow(params):
        executed.append(params)
        started.set()
        release.wait(5)
        return {"ok": 1}

    monkeypatch.setattr(agent, "get_agent_runner", lambda: agent.AgentRunner(store, lambda name: slow))
    monkeypatch.setattr(agent_internal, "ORCHESTRATABLE_METHODS", {"lectura"})
    barrier = threading.Barrier(8)
    outcomes = []

    def worker():
        barrier.wait()
        outcomes.append(_dispatch(session_id="s1", call_id="c1", name="lectura", params={"a": 1}))

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(5)
    assert started.wait(5)
    release.set()
    assert json.loads(_wait_result("c1")["result"]) == {"ok": 1}
    assert len(executed) == 1
    assert len({o["dispatch"]["op_id"] for o in outcomes}) == 1


def test_same_call_id_with_other_intent_is_a_conflict(store, monkeypatch):
    executed = []
    runner = agent.AgentRunner(store, lambda name: lambda params: executed.append(params) or {"ok": 1})
    monkeypatch.setattr(agent, "get_agent_runner", lambda: runner)
    monkeypatch.setattr(agent_internal, "ORCHESTRATABLE_METHODS", {"lectura"})
    _dispatch(session_id="s1", call_id="c1", name="lectura", params={"a": 1})
    _wait_result("c1")
    conflict = _dispatch(session_id="s1", call_id="c1", name="lectura", params={"a": 2})
    assert "otra intención" in json.loads(conflict["result"])["error"]
    assert executed == [{"a": 1}]


def test_repeated_call_id_in_another_conversation_is_independent(store, monkeypatch):
    executed = []
    runner = agent.AgentRunner(store, lambda name: lambda params: executed.append(params) or {"n": params["n"]})
    monkeypatch.setattr(agent, "get_agent_runner", lambda: runner)
    monkeypatch.setattr(agent_internal, "ORCHESTRATABLE_METHODS", {"lectura"})
    _dispatch(session_id="s1", call_id="call-1", name="lectura", params={"n": 1})
    _dispatch(session_id="s2", call_id="call-1", name="lectura", params={"n": 2})
    assert json.loads(_wait_result("call-1", session_id="s1")["result"]) == {"n": 1}
    assert json.loads(_wait_result("call-1", session_id="s2")["result"]) == {"n": 2}
    assert len(executed) == 2


def test_approval_from_another_conversation_or_with_other_params_is_rejected(store, monkeypatch):
    executed = []
    runner = agent.AgentRunner(store, lambda name: lambda params: executed.append(params) or {"ok": 1})
    monkeypatch.setattr(agent, "get_agent_runner", lambda: runner)
    monkeypatch.setattr(agent_internal._agent_chat, "gated_methods", lambda: ["db_export"])
    approval_id = _approve("s1", "c1", "db_export", {"format": "xlsx"})

    other_session = _dispatch(session_id="s2", call_id="c1", name="db_export",
                              params={"format": "xlsx"}, approval_id=approval_id)
    assert json.loads(other_session["result"]).get("error")
    tampered = _dispatch(session_id="s1", call_id="c1", name="db_export",
                         params={"format": "csv"}, approval_id=approval_id)
    assert "no coinciden" in json.loads(tampered["result"])["error"]
    assert executed == []
    with pytest.raises(ValidationError):
        agent_internal.HANDLERS["agent_internal_approval_ensure"](
            {"session_id": "s1", "call_id": "c1", "method": "db_export", "params": {"format": "csv"}}
        )


def test_approval_is_consumed_once_and_survives_a_crash_between_writes(store, tmp_path, monkeypatch):
    monkeypatch.setattr(agent_internal._agent_chat, "gated_methods", lambda: ["db_export"])
    approval_id = _approve("s1", "c1", "db_export", {})
    intent = agent_internal._intent("s1", "db_export", {})
    real_write = store._write_approvals
    monkeypatch.setattr(store, "_write_approvals", lambda: None)  # caída tras la reserva
    outcome, record = store.dispatch_claim("s1", "c1", "db_export", intent, approval_id)
    assert outcome == "new"
    monkeypatch.setattr(store, "_write_approvals", real_write)

    reloaded = agent.AgentStore(tmp_path)
    assert reloaded.get_approval(approval_id)["consumed_by"] == record["op_id"]
    assert reloaded.get_dispatch("s1", "c1")["status"] == "uncertain"
    outcome, again = reloaded.dispatch_claim("s1", "c1", "db_export", intent, approval_id)
    assert outcome == "existing" and again["op_id"] == record["op_id"]
    outcome, _ = reloaded.dispatch_claim("s1", "c2", "db_export", intent, approval_id)
    assert outcome == "rejected"


def test_large_result_keeps_full_receipt_and_summarizes_for_the_model(store, monkeypatch):
    big = {"rows": ["x" * 100] * 500, "error": "fallo estructurado"}
    runner = agent.AgentRunner(store, lambda name: lambda params: big)
    monkeypatch.setattr(agent, "get_agent_runner", lambda: runner)
    monkeypatch.setattr(agent_internal, "ORCHESTRATABLE_METHODS", {"lectura"})
    _dispatch(session_id="s1", call_id="c1", name="lectura", params={})
    summary = json.loads(_wait_result("c1")["result"])
    assert summary["truncated"] is True and summary["total_chars"] > 6_000
    record = store.get_dispatch("s1", "c1")
    assert json.loads(record["result"]) == big
    assert record["status"] == "failed"


def test_effects_on_the_same_resource_run_one_after_another(store, monkeypatch):
    active = []
    overlap = []
    lock = threading.Lock()

    def effect(params):
        with lock:
            active.append(params["n"])
            overlap.append(len(active))
        time.sleep(0.2)
        with lock:
            active.remove(params["n"])
        return {"n": params["n"]}

    monkeypatch.setattr(agent, "get_agent_runner", lambda: agent.AgentRunner(store, lambda name: effect))
    monkeypatch.setattr(agent_internal._agent_chat, "gated_methods", lambda: ["canvas_save"])
    first = _approve("s1", "c1", "canvas_save", {"id": "doc", "n": 1})
    second = _approve("s2", "c2", "canvas_save", {"id": "doc", "n": 2})
    _dispatch(session_id="s1", call_id="c1", name="canvas_save", params={"id": "doc", "n": 1}, approval_id=first)
    _dispatch(session_id="s2", call_id="c2", name="canvas_save", params={"id": "doc", "n": 2}, approval_id=second)
    _wait_result("c1")
    _wait_result("c2", session_id="s2")
    assert max(overlap) == 1
