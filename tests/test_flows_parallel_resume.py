"""Ejecución paralela, límite global de concurrencia, cancelación y reanudación."""

from __future__ import annotations

import threading
import time

import pytest

from backend.core.flows import runner as runner_module
from backend.core.flows.runner import FlowRunner, cancel_run
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


def _fan_out_graph(node_ids):
    return {
        "nodes": [
            {"id": "trigger", "kind": "trigger", "config": {}},
            *[{"id": nid, "kind": "code",
               "config": {"code": "import time\ntime.sleep(0.2)\nresult = 'ok'", "auto_approve": True}}
              for nid in node_ids],
            {"id": "fin", "kind": "transform", "config": {"output": {"ok": True}}},
        ],
        "edges": [
            *[{"from_node": "trigger", "to_node": nid} for nid in node_ids],
            *[{"from_node": nid, "to_node": "fin"} for nid in node_ids],
        ],
    }


def test_parallel_branches_overlap(store):
    flow = store.create("Paralelo", graph=_fan_out_graph(["a", "b", "c"]))
    runner = FlowRunner(store, lambda m: lambda p: {})
    started = time.monotonic()
    done = _wait(runner.start(flow["id"])["id"], store)
    elapsed = time.monotonic() - started

    assert done["status"] == "success"
    # 3 code nodes de ~0.2 s en paralelo deben terminar bastante antes que en serie.
    assert elapsed < 0.55
    steps = {s["node_id"]: s for s in done["steps"]}
    assert all(steps[n]["status"] == "success" for n in ("a", "b", "c", "fin"))


def test_global_concurrency_limit(store, monkeypatch):
    """Con _NODE_SLOTS=1 los nodos no se solapan aunque el pool tenga hilos."""
    counts = {"active": 0, "max": 0}
    lock = threading.Lock()

    def fake_run_python(code, payload, timeout_s, token):
        with lock:
            counts["active"] += 1
            counts["max"] = max(counts["max"], counts["active"])
        time.sleep(0.05)
        with lock:
            counts["active"] -= 1
        return {"json": "ok"}

    monkeypatch.setattr(runner_module.code_exec, "run_python", fake_run_python)
    monkeypatch.setattr(runner_module, "_NODE_SLOTS", threading.BoundedSemaphore(1))

    flow = store.create("Límite", graph=_fan_out_graph(["a", "b", "c"]))
    runner = FlowRunner(store, lambda m: lambda p: {})
    done = _wait(runner.start(flow["id"])["id"], store)

    assert done["status"] == "success"
    assert counts["max"] == 1


def test_cancel_kills_running_code_node(store):
    flow = store.create(
        "Cancelable",
        graph={
            "nodes": [
                {"id": "trigger", "kind": "trigger", "config": {}},
                {"id": "slow", "kind": "code",
                 "config": {"code": "import time\ntime.sleep(30)\nresult = 1", "timeout_s": 60,
                            "auto_approve": True}},
            ],
            "edges": [{"from_node": "trigger", "to_node": "slow"}],
        },
    )
    runner = FlowRunner(store, lambda m: lambda p: {})
    run = runner.start(flow["id"])
    for _ in range(100):
        step = next((s for s in (store.get_run(run["id"]) or {}).get("steps") or [] if s["node_id"] == "slow"), None)
        if step and step["status"] == "running":
            break
        time.sleep(0.05)

    started = time.monotonic()
    assert cancel_run(run["id"]) is True
    done = _wait(run["id"], store, timeout=10)
    assert time.monotonic() - started < 5
    assert done["status"] == "cancelled"
    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["slow"]["status"] == "cancelled"


def test_resume_interrupted_rerun_from_checkpoint(store):
    flow = store.create(
        "Reanudable",
        graph={
            "nodes": [
                {"id": "trigger", "kind": "trigger", "config": {}},
                {"id": "a", "kind": "transform", "config": {"output": {"v": 1}}},
                {"id": "b", "kind": "transform", "config": {"output": {"v": 2}}},
            ],
            "edges": [
                {"from_node": "trigger", "to_node": "a"},
                {"from_node": "a", "to_node": "b"},
            ],
        },
    )
    run = store.create_run(flow["id"], {"k": 1})
    store.update_run(
        run["id"],
        status="running",
        started_at="2026-10-04T00:00:00Z",
        checkpoint={
            "outputs": {"trigger": {"main": {"json": {"k": 1}}}, "a": {"main": {"json": {"v": 1}}}},
            "settled": {"trigger": "success", "a": "success"},
            "pending": {},
            "approvals": {},
        },
    )

    # Simula el cierre de la app: un nuevo store marca el run como interrumpido.
    restored = FlowStore(store._flows_path, store._runs_path)
    resumed_run = restored.get_run(run["id"])
    assert resumed_run["status"] == "queued"
    assert resumed_run["interrupted"] is True

    runner = FlowRunner(restored, lambda m: lambda p: {})
    assert runner.resume_interrupted() == 1
    done = _wait(run["id"], restored)

    assert done["status"] == "success"
    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["b"]["status"] == "success"
    assert steps["b"]["output"] == {"v": 2}


def test_resume_loop_keeps_completed_iterations(store):
    """Un bucle interrumpido reanuda sin repetir los nodos ya completados."""
    flow = store.create(
        "Bucle reanudable",
        graph={
            "nodes": [
                {"id": "trigger", "kind": "trigger", "config": {}},
                {"id": "src", "kind": "transform", "config": {"output": {"lista": [1, 2, 3]}}},
                {"id": "l1", "kind": "loop", "config": {"over": "=nodes.src.json.lista"}},
                {"id": "dup", "kind": "code",
                 "config": {"code": "result = item * 2", "auto_approve": True}},
            ],
            "edges": [
                {"from_node": "trigger", "to_node": "src"},
                {"from_node": "src", "to_node": "l1"},
                {"from_node": "l1", "to_node": "dup", "from_port": "each"},
            ],
        },
    )
    run = store.create_run(flow["id"], None)
    store.update_run(
        run["id"],
        status="running",
        started_at="2026-10-05T00:00:00Z",
        checkpoint={
            "outputs": {"trigger": {"main": {"json": {}}},
                        "src": {"main": {"json": {"lista": [1, 2, 3]}}}},
            "settled": {"trigger": "success", "src": "success"},
            "pending": {},
            "approvals": {},
            # Estado real tras interrumpir la iteración 1: la 0 ya produjo su
            # entrada y el cuerpo de la 1 ya corrió (efecto no repetible).
            "loops": {"l1": {
                "index": 1,
                "collected": [{"item": 1, "dup": 2}],
                "iteration_outputs": {"dup": {"main": {"json": 4}}},
                "body_settled": {"dup": "success"},
            }},
        },
    )

    restored = FlowStore(store._flows_path, store._runs_path)
    runner = FlowRunner(restored, lambda m: lambda p: {})
    assert runner.resume_interrupted() == 1
    done = _wait(run["id"], restored)

    assert done["status"] == "success"
    steps = {s["node_id"]: s for s in done["steps"]}
    loop_out = steps["l1"]["output"]
    assert loop_out["count"] == 3
    assert [entry["dup"] for entry in loop_out["items"]] == [2, 4, 6]
    # El cuerpo ya ejecutado no se repite; solo corre la última iteración.
    dup_steps = [s for s in done["steps"] if s["node_id"] == "dup"]
    assert sorted(s["iteration"] for s in dup_steps) == [2]


def test_resume_loop_completed_iteration_not_duplicated(store):
    """El checkpoint tras completar una iteración apunta a la siguiente: no se
    re-añade la entrada ya recolectada ni se repite el cuerpo."""
    flow = store.create(
        "Bucle tras iteración completa",
        graph={
            "nodes": [
                {"id": "trigger", "kind": "trigger", "config": {}},
                {"id": "src", "kind": "transform", "config": {"output": {"lista": [1, 2, 3]}}},
                {"id": "l1", "kind": "loop", "config": {"over": "=nodes.src.json.lista"}},
                {"id": "dup", "kind": "code",
                 "config": {"code": "result = item * 2", "auto_approve": True}},
            ],
            "edges": [
                {"from_node": "trigger", "to_node": "src"},
                {"from_node": "src", "to_node": "l1"},
                {"from_node": "l1", "to_node": "dup", "from_port": "each"},
            ],
        },
    )
    run = store.create_run(flow["id"], None)
    store.update_run(
        run["id"],
        status="running",
        started_at="2026-10-05T00:00:00Z",
        checkpoint={
            "outputs": {"trigger": {"main": {"json": {}}},
                        "src": {"main": {"json": {"lista": [1, 2, 3]}}}},
            "settled": {"trigger": "success", "src": "success"},
            "pending": {},
            "approvals": {},
            # Formato anterior tras completar la iteración 0: `index` seguía en
            # la iteración hecha y su entrada ya estaba en `collected`.
            "loops": {"l1": {
                "index": 0,
                "collected": [{"item": 1, "dup": 2}],
                "iteration_outputs": {"dup": {"main": {"json": 2}}},
                "body_settled": {"dup": "success"},
            }},
        },
    )

    restored = FlowStore(store._flows_path, store._runs_path)
    runner = FlowRunner(restored, lambda m: lambda p: {})
    assert runner.resume_interrupted() == 1
    done = _wait(run["id"], restored)

    assert done["status"] == "success"
    steps = {s["node_id"]: s for s in done["steps"]}
    loop_out = steps["l1"]["output"]
    assert loop_out["count"] == 3
    assert [entry["dup"] for entry in loop_out["items"]] == [2, 4, 6]
    dup_steps = [s for s in done["steps"] if s["node_id"] == "dup"]
    assert sorted(s["iteration"] for s in dup_steps) == [1, 2]
