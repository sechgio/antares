"""Disparadores ``app_event`` y ``webhook`` de los flujos."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

import pytest

from backend.core.flows import events
from backend.core.flows.runner import FlowRunner
from backend.core.flows.store import FlowStore
from backend.core.flows.webhooks import WebhookServer, _check_secret


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


def _wait_for_runs(store: FlowStore, count: int, timeout: float = 15.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        runs = store.list_runs(limit=50)
        if len(runs) >= count:
            return runs
        time.sleep(0.05)
    raise AssertionError("no llegaron los runs esperados")


def _event_flow(trigger_config, sink_output=None):
    return {
        "nodes": [
            {"id": "trigger", "kind": "trigger", "config": trigger_config},
            {"id": "t", "kind": "transform",
             "config": {"output": sink_output or {"ev": "=run.trigger.event"}}},
        ],
        "edges": [{"from_node": "trigger", "to_node": "t"}],
    }


def test_app_event_dispatches_matching_flow(store):
    store.create("Por evento", graph=_event_flow(
        {"trigger_kind": "app_event", "event": "job_finished"}))
    runner = FlowRunner(store, lambda m: lambda p: {})

    events.set_dispatcher(events.make_dispatcher(store, runner))
    try:
        events.emit("job_finished", {"job_id": "j1"})
        events.emit("other_event", {})
        runs = _wait_for_runs(store, 1)
    finally:
        events.set_dispatcher(None)

    run = _wait(runs[0]["id"], store)
    assert run["status"] == "success"
    assert run["trigger_payload"]["event"] == "job_finished"
    steps = {s["node_id"]: s for s in run["steps"]}
    assert steps["t"]["output"] == {"ev": "job_finished"}


def test_app_event_disabled_flow_does_not_run(store):
    flow = store.create("Desactivado", graph=_event_flow(
        {"trigger_kind": "app_event", "event": "job_finished"}))
    store.update(flow["id"], enabled=False)
    runner = FlowRunner(store, lambda m: lambda p: {})

    events.set_dispatcher(events.make_dispatcher(store, runner))
    try:
        events.emit("job_finished", {})
        time.sleep(0.3)
    finally:
        events.set_dispatcher(None)
    assert store.list_runs(limit=50) == []


def test_flow_finished_chain_terminates(store):
    """Un flujo escuchando flow_finished no se autodispara en cadena."""
    a = store.create("A", graph=_event_flow(
        {"trigger_kind": "app_event", "event": "flow_finished"}))
    b = store.create("B", graph=_event_flow(
        {"trigger_kind": "app_event", "event": "flow_finished"}))
    runner = FlowRunner(store, lambda m: lambda p: {})

    events.set_dispatcher(events.make_dispatcher(store, runner))
    try:
        runner.start(a["id"])
        time.sleep(1.5)
    finally:
        events.set_dispatcher(None)
    runs = store.list_runs(limit=50)
    # A corre manual; al terminar dispara B (no está en la cadena). El fin de B
    # emite con cadena [A, B] y ambos quedan excluidos: la cadena termina.
    assert sorted(r["flow_id"] for r in runs) == sorted([a["id"], b["id"]])


def test_webhook_requires_secret(store):
    with pytest.raises(ValueError, match="clave secreta"):
        store.create("Hook sin clave", graph=_event_flow({"trigger_kind": "webhook"}))


def _post(url: str, body: dict | None = None, headers: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read() or b"{}")


def test_webhook_starts_run(store, monkeypatch):
    monkeypatch.setenv("ANTARES_FLOWS_WEBHOOK_PORT", "47913")
    flow = store.create("Hook", graph=_event_flow(
        {"trigger_kind": "webhook", "path": "alta", "secret": "s3cr3t"},
        sink_output={"body": "=run.trigger.body.msg"}))
    runner = FlowRunner(store, lambda m: lambda p: {})
    server = WebhookServer(lambda: store, lambda: runner)
    server.start()
    try:
        assert server.port
        base = f"http://127.0.0.1:{server.port}/hooks/{flow['id']}"

        assert _post(base + "/alta", {"msg": "x"})[0] == 403
        assert _post(base + "/otro", {"msg": "x"}, {"X-Antares-Flow-Key": "s3cr3t"})[0] == 404
        status, reply = _post(base + "/alta", {"msg": "hola"}, {"X-Antares-Flow-Key": "s3cr3t"})
        assert status == 202
        run = _wait(reply["run_id"], store)
    finally:
        if server._server is not None:
            server._server.shutdown()

    assert run["status"] == "success"
    steps = {s["node_id"]: s for s in run["steps"]}
    assert steps["t"]["output"] == {"body": "hola"}


def test_webhook_query_key_also_works(store, monkeypatch):
    monkeypatch.setenv("ANTARES_FLOWS_WEBHOOK_PORT", "47929")
    flow = store.create("Hook key", graph=_event_flow(
        {"trigger_kind": "webhook", "secret": "k9"},
        sink_output={"src": "=run.trigger.source"}))
    runner = FlowRunner(store, lambda m: lambda p: {})
    server = WebhookServer(lambda: store, lambda: runner)
    server.start()
    try:
        status, reply = _post(
            f"http://127.0.0.1:{server.port}/hooks/{flow['id']}?key=k9", {"a": 1})
        assert status == 202
        done = _wait(reply["run_id"], store)
    finally:
        if server._server is not None:
            server._server.shutdown()
    assert done["status"] == "success"
    # La clave autentica pero no queda guardada en el payload del run.
    assert "key" not in (done["trigger_payload"].get("query") or {})


def test_webhook_without_secret_never_dispatches():
    flow = {
        "id": "f1",
        "enabled": True,
        "graph": {
            "nodes": [{"id": "t", "kind": "trigger",
                       "config": {"trigger_kind": "webhook"}}],
            "edges": [],
        },
    }
    assert _check_secret(flow, {}, {}) is False
    assert _check_secret(flow, {"X-Antares-Flow-Key": "x"}, {}) is False
    assert _check_secret(flow, {}, {"key": ["x"]}) is False
