"""Recuperación de runs interrumpidos al iniciar un nuevo backend."""

import json

import pytest

from backend.core.flows.store import MAX_TOTAL_RUNS, FlowStore


@pytest.mark.parametrize("status", ["queued", "running"])
def test_reopening_store_finishes_interrupted_run(tmp_path, status):
    paths = tmp_path / "flows.json", tmp_path / "runs.json"
    store = FlowStore(*paths)
    flow = store.create("Interrumpido")
    run = store.create_run(flow["id"], {"valor": 7})
    if status == "running":
        store.update_run(run["id"], status=status, started_at="2026-10-04T00:00:00Z")
    restored = FlowStore(*paths)
    done = restored.get_run(run["id"])
    assert done["status"] == "error"
    assert "interrumpida" in done["error"]
    assert done["finished_at"]
    assert done["graph"] == run["graph"]
    assert done["trigger_payload"] == {"valor": 7}
    assert restored.get(flow["id"])["last_run_status"] == "error"
    assert FlowStore(*paths).get_run(run["id"]) == done


def test_recovery_prunes_orphans_without_changing_terminal_runs(tmp_path):
    paths = tmp_path / "flows.json", tmp_path / "runs.json"
    store = FlowStore(*paths)
    flow = store.create("Muchos runs")
    run = store.create_run(flow["id"])
    runs = {
        str(i): {**run, "id": str(i), "created_at": f"2026-10-04T00:{i:04d}:00Z"}
        for i in range(MAX_TOTAL_RUNS + 50)
    }
    terminal = {**run, "id": "terminal", "status": "success", "finished_at": "ok", "created_at": "9999"}
    runs["terminal"] = terminal
    paths[1].write_text(json.dumps(runs), encoding="utf-8")
    store._touch_last_run(flow["id"], "success", "ok")
    restored = FlowStore(*paths)
    assert len(restored.list_runs(limit=1000)) <= MAX_TOTAL_RUNS
    assert all(r["status"] not in ("running", "queued") for r in restored.list_runs(limit=1000))
    assert restored.get_run("terminal") == terminal
    assert restored.get(flow["id"])["last_run_status"] == "success"
