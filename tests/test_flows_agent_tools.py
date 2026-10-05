"""Nodo ``agent`` con herramientas y aprobaciones dentro del run."""

from __future__ import annotations

import time

import pytest

from backend.core.flows import agent_chat
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
    waiting = _wait(run["id"], store, timeout=15)

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
        {"text": "", "calls": [{"id": "c1", "name": "flows_run", "params": {"flow_id": "x"}}]},
        {"text": "listo", "calls": []},
    ])
    monkeypatch.setattr(agent_chat, "chat", lambda *a, **k: next(replies))

    flow = store.create("Agente auto", graph=_agent_flow(
        {"provider": "ollama", "prompt": "ejecuta", "tools": True, "auto_approve": True}))
    runner = FlowRunner(
        store,
        lambda m: (lambda p: executed.append(m) or {"ok": True}) if m == "flows_run" else None,
    )
    done = _wait_done(runner.start(flow["id"])["id"], store)

    assert done["status"] == "success"
    assert executed == ["flows_run"]


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
