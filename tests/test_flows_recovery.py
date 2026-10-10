"""Recuperación de runs interrumpidos al iniciar un nuevo backend."""

import json

import pytest

from backend.core.flows.store import MAX_TOTAL_RUNS, FlowStore
from backend.handlers import flows as flow_handlers


@pytest.mark.parametrize("status", ["queued", "running"])
def test_reopening_store_marks_interrupted_run_resumable(tmp_path, status):
    paths = tmp_path / "flows.json", tmp_path / "runs.json"
    store = FlowStore(*paths)
    flow = store.create("Interrumpido")
    run = store.create_run(flow["id"], {"valor": 7})
    if status == "running":
        store.update_run(run["id"], status=status, started_at="2026-10-04T00:00:00Z")
    restored = FlowStore(*paths)
    resumed = restored.get_run(run["id"])
    assert resumed["status"] == "queued"
    assert resumed["interrupted"] is True
    assert resumed["finished_at"] is None
    assert resumed["graph"] == run["graph"]
    assert resumed["trigger_payload"] == {"valor": 7}
    assert restored.get(flow["id"])["last_run_status"] == "queued"
    assert FlowStore(*paths).get_run(run["id"]) == resumed


def test_reopening_store_keeps_waiting_run(tmp_path):
    paths = tmp_path / "flows.json", tmp_path / "runs.json"
    store = FlowStore(*paths)
    flow = store.create("En espera")
    run = store.create_run(flow["id"])
    store.update_run(run["id"], status="waiting", started_at="2026-10-04T00:00:00Z")
    restored = FlowStore(*paths)
    kept = restored.get_run(run["id"])
    assert kept["status"] == "waiting"
    assert kept["interrupted"] is False


def test_recovery_prunes_orphans_without_changing_terminal_runs(tmp_path):
    paths = tmp_path / "flows.json", tmp_path / "runs.json"
    store = FlowStore(*paths)
    flow = store.create("Muchos runs")
    run = store.create_run(flow["id"])
    runs = {
        str(i): {**run, "id": str(i), "status": "success", "finished_at": "ok",
                 "created_at": f"2026-10-04T00:{i:04d}:00Z"}
        for i in range(MAX_TOTAL_RUNS + 50)
    }
    terminal = {**run, "id": "terminal", "status": "success", "finished_at": "ok", "created_at": "9999"}
    runs["terminal"] = terminal
    paths[1].write_text(json.dumps(runs), encoding="utf-8")
    store._touch_last_run(flow["id"], "success", "ok")
    restored = FlowStore(*paths)
    fresh = restored.create_run(flow["id"])  # la escritura sanea los terminales en exceso
    kept = restored.list_runs(limit=1000)
    assert len(kept) <= MAX_TOTAL_RUNS + 1  # +1: el run resumable nuevo siempre se conserva
    assert restored.get_run("terminal") == terminal
    assert restored.get_run(fresh["id"])["status"] == "queued"
    assert restored.get(flow["id"])["last_run_status"] == "queued"


def test_path_authorization_can_verify_saved_grants_without_resigning(tmp_path, monkeypatch):
    store = FlowStore(tmp_path / "flows.json", tmp_path / "flow_runs.json")
    monkeypatch.setattr(flow_handlers, "_store", lambda: store)
    grants = store.authorize_paths({
        "read": ["C:/reports/input.xlsx"],
        "write": ["C:/reports/output"],
        "folders": ["C:/reports"],
    })

    assert flow_handlers._authorize_paths({**grants, "_verify": True}) == {"valid": True}
    tampered = {**grants, "read": ["C:/private.xlsx"], "_verify": True}
    assert flow_handlers._authorize_paths(tampered) == {"valid": False}
    assert store.verify_paths(grants)
