"""Pruebas de los nodos avanzados del motor de flujos: switch, agent y retry."""

from __future__ import annotations

import time

import pytest

from backend.core.flows.runner import FlowRunner
from backend.core.flows.schema import normalize_graph, validate_graph
from backend.core.flows.store import FlowStore


@pytest.fixture()
def store(tmp_path):
    return FlowStore(tmp_path / "flows.json", tmp_path / "flow_runs.json")


def _wait(run_id: str, store: FlowStore, timeout: float = 5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = store.get_run(run_id)
        if run is not None and run["status"] not in ("queued", "running"):
            return run
        time.sleep(0.05)
    raise AssertionError("run did not finish")


def test_runner_switch_routes_matched_case(store):
    flow = store.create(
        "Switch",
        graph={
            "nodes": [
                {"id": "trigger", "kind": "trigger", "config": {}},
                {
                    "id": "sw",
                    "kind": "switch",
                    "config": {
                        "field": "=run.trigger.modo",
                        "cases": [
                            {"value": "a", "port": "caso_a"},
                            {"value": "b", "port": "caso_b"},
                        ],
                    },
                },
                {"id": "a", "kind": "transform", "config": {"output": {"rama": "a"}}},
                {"id": "b", "kind": "transform", "config": {"output": {"rama": "b"}}},
                {"id": "d", "kind": "transform", "config": {"output": {"rama": "defecto"}}},
            ],
            "edges": [
                {"from_node": "trigger", "to_node": "sw"},
                {"from_node": "sw", "to_node": "a", "from_port": "caso_a"},
                {"from_node": "sw", "to_node": "b", "from_port": "caso_b"},
                {"from_node": "sw", "to_node": "d", "from_port": "default"},
            ],
        },
    )
    runner = FlowRunner(store, lambda m: lambda p: {})
    done = _wait(runner.start(flow["id"], {"modo": "b"})["id"], store)
    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["a"]["status"] == "skipped"
    assert steps["b"]["status"] == "success"
    assert steps["d"]["status"] == "skipped"
    assert steps["sw"]["output"]["case"] == "caso_b"

    done2 = _wait(runner.start(flow["id"], {"modo": "zz"})["id"], store)
    steps2 = {s["node_id"]: s for s in done2["steps"]}
    assert steps2["d"]["status"] == "success"
    assert steps2["a"]["status"] == "skipped"


def test_validate_rejects_switch_without_field():
    with pytest.raises(ValueError, match=r"config\.field"):
        validate_graph(
            normalize_graph(
                {
                    "nodes": [
                        {"id": "trigger", "kind": "trigger", "config": {}},
                        {"id": "sw", "kind": "switch", "config": {}},
                    ]
                }
            )
        )


def test_validate_rejects_switch_duplicate_port():
    with pytest.raises(ValueError, match="duplicado"):
        validate_graph(
            normalize_graph(
                {
                    "nodes": [
                        {"id": "trigger", "kind": "trigger", "config": {}},
                        {
                            "id": "sw",
                            "kind": "switch",
                            "config": {
                                "field": "=item",
                                "cases": [{"value": 1, "port": "x"}, {"value": 2, "port": "x"}],
                            },
                        },
                    ]
                }
            )
        )


def test_validate_rejects_bad_retry():
    with pytest.raises(ValueError, match=r"retry\.attempts"):
        validate_graph(
            normalize_graph(
                {
                    "nodes": [
                        {"id": "trigger", "kind": "trigger", "config": {}},
                        {
                            "id": "t",
                            "kind": "transform",
                            "config": {"retry": {"attempts": 9}},
                        },
                    ]
                }
            )
        )


def test_runner_retries_until_success(store):
    attempts = {"n": 0}

    def fake_handler(method):
        def invoke(params):
            attempts["n"] += 1
            if attempts["n"] < 3:
                raise ValueError("fallo transitorio")
            return {"ok": True}

        return invoke

    flow = store.create(
        "Retry",
        graph={
            "nodes": [
                {"id": "trigger", "kind": "trigger", "config": {}},
                {
                    "id": "t",
                    "kind": "tool_call",
                    "config": {"method": "formats", "retry": {"attempts": 3, "delay_ms": 1}},
                },
            ],
            "edges": [{"from_node": "trigger", "to_node": "t"}],
        },
    )
    runner = FlowRunner(store, fake_handler)
    done = _wait(runner.start(flow["id"])["id"], store)

    assert done["status"] == "success"
    assert attempts["n"] == 3
    step = {s["node_id"]: s for s in done["steps"]}["t"]
    assert step["attempts"] == 3


def test_runner_retry_exhausts(store):
    def fake_handler(method):
        return lambda params: (_ for _ in ()).throw(ValueError("siempre falla"))

    flow = store.create(
        "RetryFail",
        graph={
            "nodes": [
                {"id": "trigger", "kind": "trigger", "config": {}},
                {
                    "id": "t",
                    "kind": "tool_call",
                    "config": {"method": "formats", "retry": {"attempts": 2}},
                },
            ],
            "edges": [{"from_node": "trigger", "to_node": "t"}],
        },
    )
    runner = FlowRunner(store, fake_handler)
    done = _wait(runner.start(flow["id"])["id"], store)

    assert done["status"] == "error"
    step = {s["node_id"]: s for s in done["steps"]}["t"]
    assert step["attempts"] == 2
    assert "siempre falla" in step["error"]


def test_runner_agent_node(store, monkeypatch):
    from backend.core.flows import agent_chat

    seen = {}

    def fake_chat(provider, model, messages, with_tools=True, system=None):
        seen["provider"] = provider
        seen["model"] = model
        seen["messages"] = messages
        seen["with_tools"] = with_tools
        seen["system"] = system
        return {"text": "respuesta del modelo", "calls": []}

    monkeypatch.setattr(agent_chat, "chat", fake_chat)
    monkeypatch.setattr(
        agent_chat.ai_providers,
        "get_provider",
        lambda provider: {"chat": {"default_model": "mod-test", "style": "openai_chat", "path": "/c"}},
    )

    flow = store.create(
        "IA",
        graph={
            "nodes": [
                {"id": "trigger", "kind": "trigger", "config": {}},
                {
                    "id": "ia",
                    "kind": "agent",
                    "config": {
                        "provider": "ollama",
                        "prompt": "Di hola {{ =run.trigger.nombre }}",
                        "system": "Sé breve",
                    },
                },
                {"id": "t", "kind": "transform", "config": {"output": {"txt": "=nodes.ia.json.text"}}},
            ],
            "edges": [
                {"from_node": "trigger", "to_node": "ia"},
                {"from_node": "ia", "to_node": "t"},
            ],
        },
    )
    runner = FlowRunner(store, lambda m: lambda p: {})
    done = _wait(runner.start(flow["id"], {"nombre": "mundo"})["id"], store)

    assert done["status"] == "success"
    assert seen["provider"] == "ollama"
    assert seen["model"] == "mod-test"
    assert seen["with_tools"] is False
    assert seen["system"] == "Sé breve"
    assert seen["messages"] == [{"role": "user", "content": "Di hola mundo"}]
    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["ia"]["output"]["text"] == "respuesta del modelo"
    assert steps["t"]["output"] == {"txt": "respuesta del modelo"}


def test_validate_rejects_agent_without_prompt():
    with pytest.raises(ValueError, match=r"config\.prompt"):
        validate_graph(
            normalize_graph(
                {
                    "nodes": [
                        {"id": "trigger", "kind": "trigger", "config": {}},
                        {"id": "ia", "kind": "agent", "config": {"provider": "openai"}},
                    ]
                }
            )
        )
