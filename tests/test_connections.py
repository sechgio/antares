"""Pruebas del vault de conexiones y del nodo http_request del runner."""

from __future__ import annotations

import json
import time

import pytest

from backend.core.flows import connections, vault
from backend.core.flows.runner import FlowRunner
from backend.core.flows.store import FlowStore


def test_vault_roundtrip(tmp_path):
    path = tmp_path / "conn.json"
    vault.seal("github", path, {"access_token": "abc", "refresh_token": "r"})
    assert vault.open_sealed("github", path) == {"access_token": "abc", "refresh_token": "r"}


def test_vault_rejects_tampered_payload(tmp_path):
    path = tmp_path / "conn.json"
    vault.seal("github", path, {"access_token": "abc"})
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw["data"] = raw["data"][:-4] + "AAAA"
    path.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(ValueError):
        vault.open_sealed("github", path)


def test_vault_missing_returns_none(tmp_path):
    assert vault.open_sealed("github", tmp_path / "none.json") is None


def test_provider_specs_loaded():
    specs = connections.load_provider_specs()
    assert "github" in specs
    assert "slack" in specs
    assert specs["github"]["auth"]["token_url"].startswith("https://")


def test_tokens_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(connections, "user_data_path", lambda rel: tmp_path / rel)
    connections.put_tokens("github", {"access_token": "tok", "refresh_token": "r", "expiry_date": 9_999_999_999_999})
    loaded = connections.get_tokens("github")
    assert loaded is not None and loaded["access_token"] == "tok"
    assert connections.status("github")["connected"] is True
    connections.delete_tokens("github")
    assert connections.get_tokens("github") is None


def test_unknown_provider_rejected():
    with pytest.raises(ValueError, match="desconocido"):
        connections.put_tokens("nope", {"access_token": "x"})


def test_fresh_access_token_refreshes(tmp_path, monkeypatch):
    monkeypatch.setattr(connections, "user_data_path", lambda rel: tmp_path / rel)
    connections.put_tokens(
        "github",
        {
            "access_token": "old",
            "refresh_token": "r",
            "client_id": "cid",
            "client_secret": "cs",
            "expiry_date": 1,
        },
    )
    calls: list[dict] = []

    def fake_post(url, fields, basic):
        calls.append({"url": url, "fields": fields})
        return {"access_token": "new-tok", "expires_in": 3600}

    monkeypatch.setattr(connections, "_post_form", fake_post)
    assert connections.fresh_access_token("github") == "new-tok"
    assert calls[0]["url"] == connections.load_provider_specs()["github"]["auth"]["token_url"]
    tokens = connections.get_tokens("github")
    assert tokens is not None and tokens["access_token"] == "new-tok"


def test_fresh_access_token_requires_connection(tmp_path, monkeypatch):
    monkeypatch.setattr(connections, "user_data_path", lambda rel: tmp_path / rel)
    with pytest.raises(ValueError, match="Sin conexión"):
        connections.fresh_access_token("github")


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


class _FakeResponse:
    def __init__(self, status: int, body: bytes):
        self.status = status
        self._body = body

    def read(self, n: int = -1) -> bytes:
        return self._body if n < 0 else self._body[:n]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _http_flow(config: dict) -> dict:
    return {
        "nodes": [
            {"id": "trigger", "kind": "trigger", "config": {}},
            {"id": "h", "kind": "http_request", "config": config},
        ],
        "edges": [{"from_node": "trigger", "to_node": "h"}],
    }


def test_http_request_node_json(monkeypatch, store):
    seen: dict = {}

    def fake_urlopen(req, timeout=None):
        seen["url"] = req.full_url
        seen["method"] = req.get_method()
        return _FakeResponse(200, b'{"ok": true, "n": 3}')

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    flow = store.create(
        "Http",
        graph=_http_flow({"url": "=run.trigger.url", "method": "POST", "body": {"x": "=run.trigger.n"}}),
    )
    runner = FlowRunner(store, lambda m: None)
    run = runner.start(flow["id"], {"url": "https://api.test/x", "n": 4})
    done = _wait(run["id"], store)

    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["h"]["status"] == "success"
    assert steps["h"]["output"]["status"] == 200
    assert steps["h"]["output"]["json"] == {"ok": True, "n": 3}
    assert seen["method"] == "POST"


def test_http_request_connection_ref_sends_bearer(monkeypatch, store):
    captured: dict = {}

    def fake_urlopen(req, timeout=None):
        captured["auth"] = req.headers.get("Authorization")
        return _FakeResponse(200, b"{}")

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    monkeypatch.setattr("backend.core.flows.connections.fresh_access_token", lambda p: "tok-9")

    flow = store.create(
        "HttpConn",
        graph=_http_flow({"url": "https://api.test/me", "connection_ref": "github"}),
    )
    runner = FlowRunner(store, lambda m: None)
    run = runner.start(flow["id"])
    done = _wait(run["id"], store)

    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["h"]["status"] == "success"
    assert captured["auth"] == "Bearer tok-9"


def test_http_request_rejects_non_http_scheme(store):
    flow = store.create("Bad", graph=_http_flow({"url": "file:///etc/passwd"}))
    runner = FlowRunner(store, lambda m: None)
    run = runner.start(flow["id"])
    done = _wait(run["id"], store)

    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["h"]["status"] == "error"
    assert "no permitida" in steps["h"]["error"]


def test_validate_http_request_requires_url(store):
    from backend.core.flows.schema import normalize_graph, validate_graph

    with pytest.raises(ValueError, match="requiere config"):
        validate_graph(
            normalize_graph(
                {
                    "nodes": [
                        {"id": "trigger", "kind": "trigger", "config": {}},
                        {"id": "h", "kind": "http_request", "config": {}},
                    ],
                    "edges": [],
                }
            )
        )
