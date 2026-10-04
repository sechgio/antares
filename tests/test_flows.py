"""Pruebas del motor de flujos: esquema, store y runner."""

from __future__ import annotations

import time

import pytest

from backend.core.flows.runner import FlowRunner, _CancelEvent
from backend.core.flows.scheduler import FlowScheduler, _schedule_interval_minutes
from backend.core.flows.schema import normalize_graph, validate_graph
from backend.core.flows.store import FlowStore


def _graph(**overrides):
    graph = {
        "nodes": [{"id": "trigger", "kind": "trigger", "config": {"trigger_kind": "manual"}}],
        "edges": [],
    }
    graph.update(overrides)
    return graph


def test_normalize_fills_defaults():
    graph = normalize_graph(
        {
            "nodes": [{"id": "a", "kind": "trigger", "config": {}}],
            "edges": [{"from_node": "a", "to_node": "a"}],
        }
    )
    assert graph["edges"][0]["from_port"] == "main"
    assert graph["edges"][0]["to_port"] == "main"
    assert graph["nodes"][0]["position"] == {"x": 0.0, "y": 0.0}


def test_validate_rejects_missing_trigger():
    with pytest.raises(ValueError, match="exactamente un nodo trigger"):
        validate_graph(normalize_graph({"nodes": [{"id": "a", "kind": "transform", "config": {}}]}))


def test_validate_rejects_two_triggers():
    with pytest.raises(ValueError, match="solo puede tener un nodo trigger"):
        validate_graph(
            normalize_graph(
                {
                    "nodes": [
                        {"id": "a", "kind": "trigger", "config": {}},
                        {"id": "b", "kind": "trigger", "config": {}},
                    ]
                }
            )
        )


def test_validate_rejects_duplicate_ids():
    with pytest.raises(ValueError, match="duplicado"):
        validate_graph(
            normalize_graph(
                {
                    "nodes": [
                        {"id": "trigger", "kind": "trigger", "config": {}},
                        {"id": "trigger", "kind": "transform", "config": {}},
                    ]
                }
            )
        )


def test_validate_rejects_cycles():
    with pytest.raises(ValueError, match="ciclo"):
        validate_graph(
            normalize_graph(
                {
                    "nodes": [
                        {"id": "trigger", "kind": "trigger", "config": {}},
                        {"id": "a", "kind": "transform", "config": {}},
                        {"id": "b", "kind": "transform", "config": {}},
                    ],
                    "edges": [
                        {"from_node": "a", "to_node": "b"},
                        {"from_node": "b", "to_node": "a"},
                    ],
                }
            )
        )


def test_validate_rejects_dangling_edges():
    with pytest.raises(ValueError, match="inexistente"):
        validate_graph(
            normalize_graph(
                {
                    "nodes": [{"id": "trigger", "kind": "trigger", "config": {}}],
                    "edges": [{"from_node": "trigger", "to_node": "fantasma"}],
                }
            )
        )


def test_tool_call_requires_method():
    with pytest.raises(ValueError, match=r"config\.method"):
        validate_graph(
            normalize_graph(
                {
                    "nodes": [
                        {"id": "trigger", "kind": "trigger", "config": {}},
                        {"id": "n", "kind": "tool_call", "config": {}},
                    ]
                }
            )
        )


@pytest.fixture()
def store(tmp_path):
    return FlowStore(tmp_path / "flows.json", tmp_path / "flow_runs.json")


def test_store_crud(store):
    flow = store.create("Mi flujo")
    assert store.get(flow["id"])["name"] == "Mi flujo"
    assert len(store.list_flows()) == 1

    updated = store.update(flow["id"], name="Renombrado", expected_updated_at=flow["updated_at"])
    assert updated["name"] == "Renombrado"

    with pytest.raises(ValueError, match="modificado"):
        store.update(flow["id"], name="X", expected_updated_at=flow["updated_at"])

    assert store.delete(flow["id"]) is True
    assert store.get(flow["id"]) is None


def test_store_duplicate(store):
    flow = store.create(
        "Base",
        graph={
            "nodes": [
                {"id": "trigger", "kind": "trigger", "config": {}},
                {"id": "t", "kind": "transform", "config": {"output": {"a": 1}}},
            ],
            "edges": [{"from_node": "trigger", "to_node": "t"}],
        },
    )
    copy = store.duplicate(flow["id"])
    assert copy["name"].endswith("(copia)")
    assert copy["graph"]["nodes"][1]["id"] == "t"


def _wait(run_id: str, store: FlowStore, timeout: float = 5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = store.get_run(run_id)
        if run is not None and run["status"] not in ("queued", "running"):
            return run
        time.sleep(0.05)
    raise AssertionError("run did not finish")


def test_runner_executes_dag(store):
    calls = []

    def fake_handler(method):
        def invoke(params):
            calls.append((method, params))
            return {"echo": params}

        return invoke

    flow = store.create(
        "Pipe",
        graph={
            "nodes": [
                {"id": "trigger", "kind": "trigger", "config": {}},
                {
                    "id": "list",
                    "kind": "tool_call",
                    "config": {"method": "formats", "args": {"n": "=run.trigger.n"}},
                },
                {"id": "t", "kind": "transform", "config": {"output": {"v": "=nodes.list.json.echo.n"}}},
            ],
            "edges": [
                {"from_node": "trigger", "to_node": "list"},
                {"from_node": "list", "to_node": "t"},
            ],
        },
    )
    runner = FlowRunner(store, fake_handler)
    run = runner.start(flow["id"], {"n": 7})
    done = _wait(run["id"], store)

    assert done["status"] == "success"
    assert calls == [("formats", {"n": 7})]
    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["t"]["output"] == {"v": 7}
    assert steps["trigger"]["status"] == "success"
    assert steps["list"]["status"] == "success"


def test_runner_condition_routes(store):
    def fake_handler(method):
        return lambda params: {"total": 5}

    flow = store.create(
        "Cond",
        graph={
            "nodes": [
                {"id": "trigger", "kind": "trigger", "config": {}},
                {"id": "src", "kind": "tool_call", "config": {"method": "db_fields"}},
                {
                    "id": "cond",
                    "kind": "condition",
                    "config": {"field": "=nodes.src.json.total", "op": "gt", "value": 3},
                },
                {"id": "yes", "kind": "transform", "config": {"output": {"rama": "si"}}},
                {"id": "no", "kind": "transform", "config": {"output": {"rama": "no"}}},
            ],
            "edges": [
                {"from_node": "trigger", "to_node": "src"},
                {"from_node": "src", "to_node": "cond"},
                {"from_node": "cond", "to_node": "yes", "from_port": "true"},
                {"from_node": "cond", "to_node": "no", "from_port": "false"},
            ],
        },
    )
    runner = FlowRunner(store, fake_handler)
    run = runner.start(flow["id"])
    done = _wait(run["id"], store)

    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["yes"]["status"] == "success"
    assert steps["no"]["status"] == "skipped"
    assert done["status"] == "success"


def test_runner_rejects_non_orchestratable(store):
    def fake_handler(method):
        return lambda params: {}

    flow = store.create(
        "Unsafe",
        graph={
            "nodes": [
                {"id": "trigger", "kind": "trigger", "config": {}},
                {"id": "n", "kind": "tool_call", "config": {"method": "process_start"}},
            ],
            "edges": [{"from_node": "trigger", "to_node": "n"}],
        },
    )
    runner = FlowRunner(store, fake_handler)
    run = runner.start(flow["id"])
    done = _wait(run["id"], store)

    assert done["status"] == "error"
    steps = {s["node_id"]: s for s in done["steps"]}
    assert "no orquestable" in steps["n"]["error"]


def test_runner_condition_exists_missing_field_routes_false(store):
    def fake_handler(method):
        return lambda params: {}

    flow = store.create(
        "Exists",
        graph={
            "nodes": [
                {"id": "trigger", "kind": "trigger", "config": {}},
                {
                    "id": "cond",
                    "kind": "condition",
                    "config": {"field": "=run.trigger.modo", "op": "exists"},
                },
                {"id": "yes", "kind": "transform", "config": {"output": {"rama": "si"}}},
                {"id": "no", "kind": "transform", "config": {"output": {"rama": "no"}}},
            ],
            "edges": [
                {"from_node": "trigger", "to_node": "cond"},
                {"from_node": "cond", "to_node": "yes", "from_port": "true"},
                {"from_node": "cond", "to_node": "no", "from_port": "false"},
            ],
        },
    )
    runner = FlowRunner(store, fake_handler)
    run = runner.start(flow["id"])
    done = _wait(run["id"], store)

    assert done["status"] == "success"
    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["cond"]["status"] == "success"
    assert steps["cond"]["output"] == {"result": False, "field": None}
    assert steps["yes"]["status"] == "skipped"
    assert steps["no"]["status"] == "success"


def test_validate_rejects_bad_schedule_interval():
    with pytest.raises(ValueError, match="interval_minutes"):
        validate_graph(
            normalize_graph(
                {
                    "nodes": [
                        {
                            "id": "trigger",
                            "kind": "trigger",
                            "config": {"trigger_kind": "schedule", "interval_minutes": 0},
                        }
                    ]
                }
            )
        )


def test_validate_accepts_schedule_trigger():
    graph = normalize_graph(
        {
            "nodes": [
                {
                    "id": "trigger",
                    "kind": "trigger",
                    "config": {"trigger_kind": "schedule", "interval_minutes": 15},
                }
            ]
        }
    )
    validate_graph(graph)


def test_run_snapshots_graph(store):
    flow = store.create(
        "Snapshot",
        graph={
            "nodes": [
                {"id": "trigger", "kind": "trigger", "config": {}},
                {"id": "t", "kind": "transform", "config": {"output": {"a": 1}}},
            ],
            "edges": [{"from_node": "trigger", "to_node": "t"}],
        },
    )
    runner = FlowRunner(store, lambda m: lambda p: {})
    run = runner.start(flow["id"])
    done = _wait(run["id"], store)
    assert done["graph"]["nodes"][1]["id"] == "t"
    store.update(flow["id"], name="Otro nombre")
    assert store.get_run(run["id"])["graph"]["nodes"][1]["id"] == "t"


def test_runner_executes_snapshot_despite_later_edit(store):
    flow = store.create(
        "Editado",
        graph={
            "nodes": [
                {"id": "trigger", "kind": "trigger", "config": {}},
                {"id": "t", "kind": "transform", "config": {"output": {"v": 1}}},
            ],
            "edges": [{"from_node": "trigger", "to_node": "t"}],
        },
    )
    run = store.create_run(flow["id"])
    store.update(
        flow["id"],
        graph={
            "nodes": [
                {"id": "trigger", "kind": "trigger", "config": {}},
                {"id": "t", "kind": "transform", "config": {"output": {"v": 2}}},
            ],
            "edges": [{"from_node": "trigger", "to_node": "t"}],
        },
    )
    runner = FlowRunner(store, lambda m: lambda p: {})
    runner._execute(run["id"], _CancelEvent())
    done = store.get_run(run["id"])

    assert done["status"] == "success"
    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["t"]["output"] == {"v": 1}


def test_scheduler_fires_due_scheduled_flow(store):
    calls = []

    def fake_handler(method):
        def invoke(params):
            calls.append((method, params))
            return {"ok": True}

        return invoke

    flow = store.create(
        "Cada minuto",
        graph={
            "nodes": [
                {
                    "id": "trigger",
                    "kind": "trigger",
                    "config": {"trigger_kind": "schedule", "interval_minutes": 1},
                },
                {"id": "n", "kind": "tool_call", "config": {"method": "formats"}},
            ],
            "edges": [{"from_node": "trigger", "to_node": "n"}],
        },
    )
    runner = FlowRunner(store, fake_handler)
    scheduler = FlowScheduler(store, runner)

    assert scheduler.tick() == 1
    assert store.get(flow["id"])["last_scheduled_at"] is not None
    # Un flujo deshabilitado no se dispara
    store.update(flow["id"], enabled=False)
    assert scheduler.tick() == 0
    # Nada vuelve a dispararse antes del intervalo
    store.update(flow["id"], enabled=True)
    assert scheduler.tick() == 0

    runs = store.list_runs(flow["id"])
    assert len(runs) == 1
    assert runs[0]["trigger_payload"]["source"] == "schedule"
    done = _wait(runs[0]["id"], store)
    assert done["status"] == "success"
    assert calls == [("formats", {})]


def test_schedule_interval_minutes(store):
    flow = store.create(
        "Programado",
        graph={
            "nodes": [
                {
                    "id": "trigger",
                    "kind": "trigger",
                    "config": {"trigger_kind": "schedule", "interval_minutes": 30},
                }
            ]
        },
    )
    assert _schedule_interval_minutes(flow) == 30
    manual = store.create("Manual")
    assert _schedule_interval_minutes(manual) is None
