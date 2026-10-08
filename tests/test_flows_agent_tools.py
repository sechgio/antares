"""Nodo ``agent`` con herramientas y aprobaciones dentro del run."""

from __future__ import annotations

import json
import time

import pytest

from backend.core.flows import agent_chat, agent_node
from backend.core.flows.runner import FlowRunner
from backend.core.flows.store import FlowStore


@pytest.fixture()
def store(tmp_path):
    return FlowStore(tmp_path / "flows.json", tmp_path / "flow_runs.json")


def _wait(run_id: str, store: FlowStore, timeout: float = 15.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = store.get_run(run_id)
        if run is not None and run["status"] not in ("queued", "running"):
            return run
        time.sleep(0.05)
    raise AssertionError("run did not finish")


def _wait_done(run_id: str, store: FlowStore, timeout: float = 15.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = store.get_run(run_id)
        if run is not None and run["status"] not in ("queued", "running", "waiting"):
            return run
        time.sleep(0.05)
    raise AssertionError("run did not finish")


def _provider_stub(monkeypatch):
    monkeypatch.setattr(
        agent_chat.ai_providers,
        "get_provider",
        lambda provider: {"chat": {"default_model": "mod-test", "style": "openai_chat", "path": "/c"}},
    )
    monkeypatch.setattr(
        agent_chat.ai_providers,
        "public_state",
        lambda provider: {"default_model": "mod-test"},
    )
    # El scheduler global puede quedar detenido por tests anteriores: las llamadas
    # del agente se ejercen en línea (este archivo no prueba el scheduler).
    monkeypatch.setattr(
        FlowRunner, "_lane_submit", lambda self, name, fn, args: fn(args)
    )


def _agent_flow(agent_config):
    return {
        "nodes": [
            {"id": "trigger", "kind": "trigger", "config": {}},
            {"id": "ia", "kind": "agent", "config": agent_config},
        ],
        "edges": [{"from_node": "trigger", "to_node": "ia"}],
    }


def test_agent_tools_execute_orchestratable_call(store, monkeypatch):
    _provider_stub(monkeypatch)
    executed: list[str] = []
    replies = iter([
        {"text": "", "calls": [{"id": "c1", "name": "flows_list", "params": {}}]},
        {"text": "hecho", "calls": []},
    ])

    def fake_chat(provider, model, messages, with_tools=True, system=None):
        assert with_tools is True
        return next(replies)

    monkeypatch.setattr(agent_chat, "chat", fake_chat)

    def handler_getter(method):
        if method == "flows_list":
            return lambda p: executed.append(method) or {"flows": ["f1"]}
        return None

    flow = store.create("Agente tools", graph=_agent_flow(
        {"provider": "ollama", "prompt": "lista flujos", "tools": True}))
    runner = FlowRunner(store, handler_getter)
    done = _wait(runner.start(flow["id"])["id"], store)

    assert done["status"] == "success"
    assert executed == ["flows_list"]
    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["ia"]["output"]["text"] == "hecho"


def test_agent_tools_gated_call_waits_for_approval(store, monkeypatch):
    _provider_stub(monkeypatch)
    executed: list[str] = []
    replies = iter([
        {"text": "", "calls": [{"id": "c1", "name": "flows_run", "params": {"flow_id": "x"}}]},
        {"text": "aprobado", "calls": []},
    ])
    monkeypatch.setattr(agent_chat, "chat", lambda *a, **k: next(replies))

    def handler_getter(method):
        if method == "flows_run":
            return lambda p: executed.append(method) or {"run": "ok"}
        return None

    flow = store.create("Agente gated", graph=_agent_flow(
        {"provider": "ollama", "prompt": "ejecuta", "tools": True}))
    runner = FlowRunner(store, handler_getter)
    run = runner.start(flow["id"])
    waiting = _wait(run["id"], store)

    assert waiting["status"] == "waiting"
    approvals = (waiting.get("checkpoint") or {}).get("approvals") or {}
    assert len(approvals) == 1
    approval = next(iter(approvals.values()))
    assert approval["method"] == "flows_run"
    assert approval["decision"] is None
    assert executed == []

    runner.decide_approval(run["id"], approval["id"], True)
    done = _wait_done(run["id"], store)

    assert done["status"] == "success"
    assert executed == ["flows_run"]
    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["ia"]["status"] == "success"
    assert steps["ia"]["output"]["text"] == "aprobado"


def test_agent_requests_a_fresh_approval_for_each_gated_call(store, monkeypatch):
    _provider_stub(monkeypatch)
    executed: list[str] = []
    replies = iter([
        {"text": "", "calls": [
            {"id": "c1", "name": "flows_run", "params": {"flow_id": "first"}},
            {"id": "c2", "name": "flows_run", "params": {"flow_id": "second"}},
        ]},
        {"text": "ambas aprobadas", "calls": []},
    ])
    monkeypatch.setattr(agent_chat, "chat", lambda *a, **k: next(replies))

    def handler_getter(method):
        if method == "flows_run":
            return lambda params: executed.append(params["flow_id"]) or {"ok": True}
        return None

    flow = store.create("Agente dos aprobaciones", graph=_agent_flow(
        {"provider": "ollama", "prompt": "ejecuta dos", "tools": True}))
    runner = FlowRunner(store, handler_getter)
    run = runner.start(flow["id"])
    first_wait = _wait(run["id"], store)
    first_approval = next(iter(first_wait["checkpoint"]["approvals"].values()))
    assert first_approval["params"] == {"flow_id": "first"}

    runner.decide_approval(run["id"], first_approval["id"], True)
    deadline = time.time() + 15
    second_wait = None
    while time.time() < deadline:
        current = store.get_run(run["id"])
        approvals = ((current or {}).get("checkpoint") or {}).get("approvals") or {}
        if current and current["status"] == "waiting" and any(
            a.get("decision") is None and a.get("params") == {"flow_id": "second"}
            for a in approvals.values()
        ):
            second_wait = current
            break
        time.sleep(0.05)
    assert second_wait is not None, "the second call must request its own approval"
    second_approvals = second_wait["checkpoint"]["approvals"]
    second_approval = next(a for a in second_approvals.values() if a["decision"] is None)
    assert second_approval["id"] != first_approval["id"]
    assert second_approval["params"] == {"flow_id": "second"}
    assert executed == ["first"]

    runner.decide_approval(run["id"], second_approval["id"], True)
    done = _wait_done(run["id"], store)
    assert done["status"] == "success"
    assert executed == ["first", "second"]


def test_approved_agent_effect_is_not_repeated_after_checkpoint_replay(store, monkeypatch):
    _provider_stub(monkeypatch)
    monkeypatch.setattr(agent_chat, "chat", lambda *a, **k: {
        "text": "", "calls": [{"id": "c1", "name": "flows_run", "params": {"flow_id": "target"}}],
    })
    flow = store.create("Agente recuperación", graph=_agent_flow(
        {"provider": "ollama", "prompt": "ejecuta", "tools": True}))
    runner = FlowRunner(store, lambda _method: lambda _params: {"ok": True})
    waiting = _wait(runner.start(flow["id"])["id"], store)
    pending_call = waiting["checkpoint"]["pending"]["ia"]["pending_call"]
    node = next(n for n in flow["graph"]["nodes"] if n["id"] == "ia")
    memory = {
        "run": {"run_id": waiting["id"], "flow_id": flow["id"]},
        "acknowledge_uncertain": False,
    }
    executions: list[str] = []

    def perform(_call):
        executions.append("effect")
        return '{"ok": true}'

    assert runner._execute_agent_effect(node, memory, pending_call, perform) == '{"ok": true}'
    # Simula la relectura del checkpoint aprobado tras cerrar el proceso.
    assert runner._execute_agent_effect(node, memory, pending_call, perform) == '{"ok": true}'
    assert executions == ["effect"]


def test_agent_tools_denied_call_reports_error_to_model(store, monkeypatch):
    _provider_stub(monkeypatch)
    executed: list[str] = []
    seen_tool_results: list[str] = []

    replies = iter([
        {"text": "", "calls": [{"id": "c1", "name": "flows_run", "params": {}}]},
        {"text": "entendido", "calls": []},
    ])

    def fake_chat(provider, model, messages, with_tools=True, system=None):
        seen_tool_results.extend(
            m["content"] for m in messages if m.get("role") == "tool_result"
        )
        return next(replies)

    monkeypatch.setattr(agent_chat, "chat", fake_chat)

    flow = store.create("Agente denied", graph=_agent_flow(
        {"provider": "ollama", "prompt": "ejecuta", "tools": True}))
    runner = FlowRunner(store, lambda m: (executed.append(m), lambda p: {})[1])
    run = runner.start(flow["id"])
    waiting = _wait(run["id"], store)

    approval = next(iter(((waiting.get("checkpoint") or {}).get("approvals") or {}).values()))
    runner.decide_approval(run["id"], approval["id"], False)
    done = _wait_done(run["id"], store)

    assert done["status"] == "success"
    assert executed == []
    assert any("rechaz" in r for r in seen_tool_results)


def test_agent_tools_auto_approve_runs_gated_call(store, monkeypatch):
    _provider_stub(monkeypatch)
    executed: list[str] = []
    replies = iter([
        {"text": "", "calls": [{"id": "c1", "name": "canvas_save", "params": {"id": "doc1"}}]},
        {"text": "listo", "calls": []},
    ])
    monkeypatch.setattr(agent_chat, "chat", lambda *a, **k: next(replies))

    flow = store.create("Agente auto", graph=_agent_flow(
        {"provider": "ollama", "prompt": "ejecuta", "tools": True, "auto_approve": True}))
    runner = FlowRunner(
        store,
        lambda m: (lambda p: executed.append(m) or {"ok": True}) if m == "canvas_save" else None,
    )
    done = _wait_done(runner.start(flow["id"])["id"], store)

    assert done["status"] == "success"
    assert executed == ["canvas_save"]


def test_agent_tools_auto_approve_still_waits_for_destructive(store, monkeypatch):
    """auto_approve nunca cubre métodos destructivos: siguen pidiendo aprobación."""
    _provider_stub(monkeypatch)
    executed: list[str] = []
    replies = iter([
        {"text": "", "calls": [{"id": "c1", "name": "flows_delete", "params": {"id": "f1"}}]},
        {"text": "ok", "calls": []},
    ])
    monkeypatch.setattr(agent_chat, "chat", lambda *a, **k: next(replies))

    flow = store.create("Agente auto destructivo", graph=_agent_flow(
        {"provider": "ollama", "prompt": "borra", "tools": True, "auto_approve": True}))
    runner = FlowRunner(
        store,
        lambda m: (lambda p: executed.append(m) or {}) if m == "flows_delete" else None,
    )
    waiting = _wait(runner.start(flow["id"])["id"], store)

    assert waiting["status"] == "waiting"
    approval = next(iter(waiting["checkpoint"]["approvals"].values()))
    assert approval["method"] == "flows_delete"
    assert executed == []


def test_agent_tools_auto_approve_still_waits_for_mcp_tool(store, monkeypatch):
    """Las tools MCP son código de terceros: auto_approve no las cubre."""
    _provider_stub(monkeypatch)
    monkeypatch.setattr(
        agent_node.mcp_servers, "parse_agent_tool",
        lambda name: ("srv", "escribe") if name.startswith("mcp2__") else None,
    )
    monkeypatch.setattr(
        agent_chat, "tool_specs",
        lambda: [{"name": "mcp2__srv__escribe", "description": "x", "gated": True, "inputSchema": {}}],
    )
    replies = iter([
        {"text": "", "calls": [{"id": "c1", "name": "mcp2__srv__escribe", "params": {}}]},
        {"text": "ok", "calls": []},
    ])
    monkeypatch.setattr(agent_chat, "chat", lambda *a, **k: next(replies))

    flow = store.create("Agente mcp", graph=_agent_flow(
        {"provider": "ollama", "prompt": "usa mcp", "tools": True, "auto_approve": True}))
    runner = FlowRunner(store, lambda m: lambda p: {})
    waiting = _wait(runner.start(flow["id"])["id"], store)

    assert waiting["status"] == "waiting"
    approval = next(iter(waiting["checkpoint"]["approvals"].values()))
    assert approval["method"] == "mcp2__srv__escribe"


def test_tool_results_scrub_secrets():
    """Los resultados de tools que viajan al LLM no llevan secretos ni grants."""

    def handler_getter(method):
        assert method == "flows_get"
        return lambda _params: {
            "flow": {
                "graph": {
                    "nodes": [
                        {"id": "w", "kind": "trigger", "config": {
                            "secret": "s3cr3t",
                            "headers": {"Authorization": "Bearer x"},
                            "_file_grants": {"signature": "abc", "read": ["C:\\tmp"]},
                        }},
                    ]
                }
            }
        }

    out = agent_node._execute_call(
        {"name": "flows_get", "params": {}}, handler_getter, None, lambda m, a: None
    )
    assert "s3cr3t" not in out
    assert "Bearer x" not in out
    config = json.loads(out)["flow"]["graph"]["nodes"][0]["config"]
    assert config["secret"] == "…"
    assert config["headers"] == "…"
    assert config["_file_grants"] == "…"


def test_agent_tools_denied_method_never_executes(store, monkeypatch):
    _provider_stub(monkeypatch)
    executed: list[str] = []
    replies = iter([
        {"text": "", "calls": [{"id": "c1", "name": "db_clear", "params": {}}]},
        {"text": "ok", "calls": []},
    ])
    monkeypatch.setattr(agent_chat, "chat", lambda *a, **k: next(replies))

    flow = store.create("Agente denied method", graph=_agent_flow(
        {"provider": "ollama", "prompt": "borra", "tools": True}))
    runner = FlowRunner(
        store,
        lambda m: (lambda p: executed.append(m) or {}) if m == "db_clear" else None,
    )
    done = _wait(runner.start(flow["id"])["id"], store)

    assert done["status"] == "success"
    assert executed == []
