"""Pruebas de los nodos ``loop`` y ``code`` del motor de flujos."""

from __future__ import annotations

import time

import pytest

from backend.core.flows.runner import FlowRunner
from backend.core.flows.schema import normalize_graph, validate_graph
from backend.core.flows.store import FlowStore


@pytest.fixture()
def store(tmp_path):
    return FlowStore(tmp_path / "flows.json", tmp_path / "flow_runs.json")


def _wait(run_id: str, store: FlowStore, timeout: float = 15.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = store.get_run(run_id)
        if run is not None and run["status"] not in ("queued", "running", "waiting"):
            return run
        time.sleep(0.05)
    raise AssertionError("run did not finish")


def _loop_flow(body_nodes=None, edges_extra=None, loop_config=None):
    nodes = [
        {"id": "trigger", "kind": "trigger", "config": {}},
        {"id": "src", "kind": "transform", "config": {"output": {"lista": [1, 2, 3]}}},
        {"id": "l1", "kind": "loop", "config": loop_config or {"over": "=nodes.src.json.lista"}},
        *(body_nodes or [
            {"id": "dup", "kind": "code",
             "config": {"code": "result = item * 2", "auto_approve": True}},
        ]),
        {"id": "fin", "kind": "transform", "config": {"output": {"total": "=nodes.l1.json.count"}}},
    ]
    edges = [
        {"from_node": "trigger", "to_node": "src"},
        {"from_node": "src", "to_node": "l1"},
        {"from_node": "l1", "to_node": "dup", "from_port": "each"},
        {"from_node": "l1", "to_node": "fin", "from_port": "done"},
        *(edges_extra or []),
    ]
    return {"nodes": nodes, "edges": edges}


def test_loop_collects_code_results(store):
    flow = store.create("Bucle", graph=_loop_flow())
    runner = FlowRunner(store, lambda m: lambda p: {})
    done = _wait(runner.start(flow["id"])["id"], store)

    assert done["status"] == "success"
    steps = {s["node_id"]: s for s in done["steps"]}
    loop_out = steps["l1"]["output"]
    assert loop_out["count"] == 3
    assert [entry["dup"] for entry in loop_out["items"]] == [2, 4, 6]
    assert steps["fin"]["output"] == {"total": 3}
    body_steps = [s for s in done["steps"] if s["node_id"] == "dup"]
    assert len(body_steps) == 3
    assert all(s.get("iteration") is not None for s in body_steps)


def test_loop_binding_reaches_code_node(store):
    flow = store.create(
        "Bucle con índice",
        graph={
            "nodes": [
                {"id": "trigger", "kind": "trigger", "config": {}},
                {"id": "src", "kind": "transform", "config": {"output": {"lista": [7]}}},
                {"id": "l1", "kind": "loop", "config": {"over": "=nodes.src.json.lista"}},
                {"id": "idx", "kind": "code",
                 "config": {"code": "result = [loop[\"index\"], loop[\"count\"], loop[\"item\"]]",
                            "auto_approve": True}},
                {"id": "fin", "kind": "transform", "config": {"output": {"ok": True}}},
            ],
            "edges": [
                {"from_node": "trigger", "to_node": "src"},
                {"from_node": "src", "to_node": "l1"},
                {"from_node": "l1", "to_node": "idx", "from_port": "each"},
                {"from_node": "l1", "to_node": "fin", "from_port": "done"},
            ],
        },
    )
    runner = FlowRunner(store, lambda m: lambda p: {})
    done = _wait(runner.start(flow["id"])["id"], store)

    assert done["status"] == "success"
    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["l1"]["output"]["items"] == [{"item": 7, "idx": [0, 1, 7]}]


def test_loop_over_expression_and_max_items(store):
    flow = store.create(
        "Bucle acotado",
        graph=_loop_flow(loop_config={"over": "=nodes.src.json.lista", "max_items": 2}),
    )
    runner = FlowRunner(store, lambda m: lambda p: {})
    done = _wait(runner.start(flow["id"])["id"], store)

    assert done["status"] == "success"
    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["l1"]["output"]["count"] == 2


def test_code_node_sees_items_and_nodes(store):
    flow = store.create(
        "Code",
        graph={
            "nodes": [
                {"id": "trigger", "kind": "trigger", "config": {}},
                {"id": "src", "kind": "transform", "config": {"output": {"lista": [4, 5]}}},
                {"id": "c", "kind": "code",
                 "config": {"code": "result = item['lista'][0] + nodes['src']['lista'][1] + items[0]['lista'][1]",
                            "auto_approve": True}},
            ],
            "edges": [
                {"from_node": "trigger", "to_node": "src"},
                {"from_node": "src", "to_node": "c"},
            ],
        },
    )
    runner = FlowRunner(store, lambda m: lambda p: {})
    done = _wait(runner.start(flow["id"])["id"], store)

    assert done["status"] == "success"
    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["c"]["output"] == 14


def test_code_node_error_marks_step_error(store):
    flow = store.create(
        "Code falla",
        graph={
            "nodes": [
                {"id": "trigger", "kind": "trigger", "config": {}},
                {"id": "c", "kind": "code",
                 "config": {"code": "result = 1 / 0", "auto_approve": True}},
            ],
            "edges": [{"from_node": "trigger", "to_node": "c"}],
        },
    )
    runner = FlowRunner(store, lambda m: lambda p: {})
    done = _wait(runner.start(flow["id"])["id"], store)

    assert done["status"] == "error"
    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["c"]["status"] == "error"
    assert "ZeroDivisionError" in (steps["c"]["error"] or "")


def test_loop_and_code_validate(store):
    graph = normalize_graph(_loop_flow())
    validate_graph(graph)


def _wait_waiting(run_id: str, store: FlowStore, timeout: float = 15.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = store.get_run(run_id)
        if run is not None and run["status"] == "waiting":
            return run
        time.sleep(0.05)
    raise AssertionError("run did not reach waiting")


def _code_flow(code_config):
    return {
        "nodes": [
            {"id": "trigger", "kind": "trigger", "config": {}},
            {"id": "c", "kind": "code", "config": code_config},
        ],
        "edges": [{"from_node": "trigger", "to_node": "c"}],
    }


def test_code_node_waits_for_approval(store):
    flow = store.create("Code aprobado", graph=_code_flow({"code": "result = 42"}))
    runner = FlowRunner(store, lambda m: lambda p: {})
    waiting = _wait_waiting(runner.start(flow["id"])["id"], store)

    approvals = (waiting.get("checkpoint") or {}).get("approvals") or {}
    assert len(approvals) == 1
    approval = next(iter(approvals.values()))
    assert approval["method"] == "code"
    assert approval["params"]["code"] == "result = 42"

    runner.decide_approval(waiting["id"], approval["id"], True)
    done = _wait(waiting["id"], store)
    assert done["status"] == "success"
    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["c"]["output"] == 42


def test_code_node_denied_marks_step_error(store):
    flow = store.create("Code denegado", graph=_code_flow({"code": "result = 42"}))
    runner = FlowRunner(store, lambda m: lambda p: {})
    waiting = _wait_waiting(runner.start(flow["id"])["id"], store)

    approval = next(iter(((waiting.get("checkpoint") or {}).get("approvals") or {}).values()))
    runner.decide_approval(waiting["id"], approval["id"], False)
    done = _wait(waiting["id"], store)

    assert done["status"] == "error"
    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["c"]["status"] == "error"
    assert "rechaz" in (steps["c"]["error"] or "")


def test_code_node_inside_loop_shares_one_approval(store):
    flow = store.create("Bucle con código", graph=_loop_flow(
        body_nodes=[{"id": "dup", "kind": "code", "config": {"code": "result = item * 2"}}]))
    runner = FlowRunner(store, lambda m: lambda p: {})
    waiting = _wait_waiting(runner.start(flow["id"])["id"], store)

    approvals = (waiting.get("checkpoint") or {}).get("approvals") or {}
    assert len(approvals) == 1
    approval = next(iter(approvals.values()))

    runner.decide_approval(waiting["id"], approval["id"], True)
    done = _wait(waiting["id"], store)

    assert done["status"] == "success"
    steps = {s["node_id"]: s for s in done["steps"]}
    # Una sola decisión cubre las tres iteraciones del mismo código.
    assert [entry["dup"] for entry in steps["l1"]["output"]["items"]] == [2, 4, 6]
