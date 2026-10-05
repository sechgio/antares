"""Pruebas del vault de conexiones y del nodo http_request del runner."""

from __future__ import annotations

import json
import socket
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

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
def expired_connection(tmp_path, monkeypatch):
    monkeypatch.setattr(connections, "user_data_path", lambda rel: tmp_path / rel)
    monkeypatch.setattr(vault, "user_data_path", lambda rel: tmp_path / rel)
    connections.put_tokens("zoom", {
        "access_token": "old", "refresh_token": "old-refresh", "client_id": "client", "expiry_date": 1,
    })
    return "zoom"


@pytest.mark.parametrize("change", ["disconnect", "replace"])
def test_refresh_cannot_restore_changed_connection(expired_connection, monkeypatch, change):
    provider = expired_connection
    entered, release = threading.Event(), threading.Event()
    results = []

    def post(*args):
        entered.set()
        assert release.wait(3)
        return {"access_token": "refreshed", "refresh_token": "new-refresh", "expires_in": 3600}

    def refresh():
        try:
            results.append(connections.fresh_access_token(provider))
        except ValueError as exc:
            results.append(exc)

    monkeypatch.setattr(connections, "_post_form", post)
    worker = threading.Thread(target=refresh)
    worker.start()
    try:
        assert entered.wait(3)
        if change == "disconnect":
            connections.delete_tokens(provider)
        else:
            connections.put_tokens(provider, {"access_token": "replacement"})
    finally:
        release.set()
        worker.join(timeout=3)
    assert not worker.is_alive()
    assert len(results) == 1 and isinstance(results[0], ValueError)
    tokens = connections.get_tokens(provider)
    assert tokens is None if change == "disconnect" else tokens["access_token"] == "replacement"


def test_concurrent_refresh_reuses_rotated_token(expired_connection, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    calls, results = [], []

    def post(url, fields, basic):
        calls.append(fields["refresh_token"])
        if len(calls) > 1:
            raise ValueError("invalid_grant")
        entered.set()
        assert release.wait(3)
        return {"access_token": "refreshed", "refresh_token": "new-refresh", "expires_in": 3600}

    def refresh():
        try:
            results.append(connections.fresh_access_token(expired_connection))
        except ValueError as exc:
            results.append(exc)

    monkeypatch.setattr(connections, "_post_form", post)
    first, second = threading.Thread(target=refresh), threading.Thread(target=refresh)
    first.start()
    try:
        assert entered.wait(3)
        second.start()
        second.join(timeout=0.1)
    finally:
        release.set()
        first.join(timeout=3)
        if second.ident is not None:
            second.join(timeout=3)
    assert not first.is_alive() and not second.is_alive()
    assert calls == ["old-refresh"]
    assert results == ["refreshed", "refreshed"]


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


def _public_dns(monkeypatch, ip: str = "93.184.216.34"):
    monkeypatch.setattr(
        "socket.getaddrinfo",
        lambda host, *a, **k: [(2, 1, 6, "", (ip, 443))],
    )


def test_http_request_node_json(monkeypatch, store):
    seen: dict = {}

    def fake_open(_opener, req, timeout=None):
        seen["url"] = req.full_url
        seen["method"] = req.get_method()
        return _FakeResponse(200, b'{"ok": true, "n": 3}')

    _public_dns(monkeypatch)
    monkeypatch.setattr("urllib.request.OpenerDirector.open", fake_open)
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

    def fake_open(_opener, req, timeout=None):
        captured["auth"] = req.headers.get("Authorization")
        return _FakeResponse(200, b"{}")

    _public_dns(monkeypatch)
    monkeypatch.setattr("urllib.request.OpenerDirector.open", fake_open)
    monkeypatch.setattr("backend.core.flows.connections.fresh_access_token", lambda p: "tok-9")

    flow = store.create(
        "HttpConn",
        graph=_http_flow({"url": "https://api.github.com/me", "connection_ref": "github"}),
    )
    runner = FlowRunner(store, lambda m: None)
    run = runner.start(flow["id"])
    done = _wait(run["id"], store)

    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["h"]["status"] == "success"
    assert captured["auth"] == "Bearer tok-9"


def test_http_request_connection_ref_rejects_http_before_token_lookup(monkeypatch, store):
    calls = []
    _public_dns(monkeypatch)
    monkeypatch.setattr(connections, "fresh_access_token", lambda provider: calls.append("token") or "secret")
    monkeypatch.setattr(
        "urllib.request.OpenerDirector.open",
        lambda *args, **kwargs: calls.append("request") or _FakeResponse(200, b"{}"),
    )
    runner = FlowRunner(store, lambda method: None)
    node = {"config": {"url": "http://api.github.com/user", "connection_ref": "github"}}
    with pytest.raises(ValueError, match="HTTPS"):
        runner._run_http_request(node, {})
    assert calls == []


def test_http_request_connection_ref_rejects_foreign_host(monkeypatch, store):
    calls: list = []

    def fake_open(_opener, req, timeout=None):
        calls.append(req.full_url)
        return _FakeResponse(200, b"{}")

    _public_dns(monkeypatch)
    monkeypatch.setattr("urllib.request.OpenerDirector.open", fake_open)
    monkeypatch.setattr("backend.core.flows.connections.fresh_access_token", lambda p: "tok-9")

    flow = store.create(
        "HttpForeign",
        graph=_http_flow({"url": "https://api.evil.example/exfil", "connection_ref": "github"}),
    )
    runner = FlowRunner(store, lambda m: None)
    run = runner.start(flow["id"])
    done = _wait(run["id"], store)

    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["h"]["status"] == "error"
    assert "hosts autorizados" in steps["h"]["error"]
    assert calls == []


def test_http_request_connection_ref_denies_empty_token_hosts(monkeypatch, store):
    calls: list = []

    def fake_open(_opener, req, timeout=None):
        calls.append(req.full_url)
        return _FakeResponse(200, b"{}")

    _public_dns(monkeypatch)
    monkeypatch.setattr("urllib.request.OpenerDirector.open", fake_open)
    monkeypatch.setattr("backend.core.flows.connections.get_provider", lambda p: {})
    monkeypatch.setattr("backend.core.flows.connections.fresh_access_token", lambda p: "tok-9")

    flow = store.create(
        "HttpNoHosts",
        graph=_http_flow({"url": "https://api.test/x", "connection_ref": "github"}),
    )
    runner = FlowRunner(store, lambda m: None)
    run = runner.start(flow["id"])
    done = _wait(run["id"], store)

    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["h"]["status"] == "error"
    assert "hosts autorizados" in steps["h"]["error"]
    assert calls == []


def test_http_request_rejects_private_ip_literal(store):
    flow = store.create("HttpLocal", graph=_http_flow({"url": "http://127.0.0.1:9/internal"}))
    runner = FlowRunner(store, lambda m: None)
    run = runner.start(flow["id"])
    done = _wait(run["id"], store)

    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["h"]["status"] == "error"
    assert "no pública" in steps["h"]["error"]


def test_http_request_rejects_private_dns_target(monkeypatch, store):
    _public_dns(monkeypatch, ip="10.9.9.9")
    flow = store.create("HttpLan", graph=_http_flow({"url": "http://internal.example/data"}))
    runner = FlowRunner(store, lambda m: None)
    run = runner.start(flow["id"])
    done = _wait(run["id"], store)

    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["h"]["status"] == "error"
    assert "no pública" in steps["h"]["error"]


def test_http_request_rejects_dns_rebinding(monkeypatch, store):
    hits = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            hits.append(self.path)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    lookups = []
    resolve = socket.getaddrinfo

    def rebind(host, port, *args, **kwargs):
        if host == "rebind.example":
            lookups.append(port)
            host = "93.184.216.34" if len(lookups) == 1 else "127.0.0.1"
        return resolve(host, port, *args, **kwargs)

    monkeypatch.delenv("ANTARES_FLOWS_ALLOW_PRIVATE_HOSTS", raising=False)
    monkeypatch.setattr("urllib.request.getproxies", lambda: {})
    monkeypatch.setattr(socket, "getaddrinfo", rebind)
    runner = FlowRunner(store, lambda method: None)
    try:
        with pytest.raises(ValueError, match="no pública"):
            runner._run_http_request({"config": {"url": f"http://rebind.example:{server.server_port}/private"}}, {})
        assert hits == []
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)


def test_http_request_private_host_with_opt_out(monkeypatch, store):
    monkeypatch.setenv("ANTARES_FLOWS_ALLOW_PRIVATE_HOSTS", "1")
    monkeypatch.setattr(
        "urllib.request.OpenerDirector.open",
        lambda _opener, req, timeout=None: _FakeResponse(200, b"{}"),
    )

    flow = store.create("HttpLanOk", graph=_http_flow({"url": "http://127.0.0.1:9/internal"}))
    runner = FlowRunner(store, lambda m: None)
    run = runner.start(flow["id"])
    done = _wait(run["id"], store)

    steps = {s["node_id"]: s for s in done["steps"]}
    assert steps["h"]["status"] == "success"


def test_redirect_strips_authorization_off_allowlist(monkeypatch):
    from backend.core.flows.http_guard import FlowRedirectHandler

    _public_dns(monkeypatch)
    req = urllib.request.Request(
        "https://api.github.com/x",
        headers={"Authorization": "Bearer tok-9", "X-Api-Key": "secret", "Cookie": "session=secret"},
    )
    handler = FlowRedirectHandler(frozenset({"api.github.com"}))
    new_req = handler.redirect_request(req, None, 302, "Found", {}, "https://evil.example/exfil")
    assert "Authorization" not in new_req.headers
    assert "X-api-key" not in new_req.headers and "Cookie" not in new_req.headers

    same_host = handler.redirect_request(req, None, 302, "Found", {}, "https://api.github.com/y")
    assert same_host.headers["Authorization"] == "Bearer tok-9"
    assert same_host.headers["X-api-key"] == "secret"


@pytest.mark.parametrize("target", ["http://api.github.com/user", "http://other.example/user"])
def test_redirect_rejects_http_with_authorization(monkeypatch, target):
    from backend.core.flows.http_guard import FlowRedirectHandler

    _public_dns(monkeypatch)
    req = urllib.request.Request("https://api.github.com/user")
    req.add_unredirected_header("Authorization", "Bearer secret")
    handler = FlowRedirectHandler(frozenset({"api.github.com"}))
    with pytest.raises(ValueError, match="HTTPS"):
        handler.redirect_request(req, None, 302, "Found", {}, target)


def test_redirect_rejects_private_target():
    from backend.core.flows.http_guard import FlowRedirectHandler

    req = urllib.request.Request("https://api.github.com/x")
    handler = FlowRedirectHandler(frozenset({"api.github.com"}))
    with pytest.raises(ValueError, match="no pública"):
        handler.redirect_request(req, None, 302, "Found", {}, "http://169.254.169.254/meta")

    with pytest.raises(ValueError, match="no permitida"):
        handler.redirect_request(req, None, 302, "Found", {}, "file:///etc/passwd")


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


def test_https_preserves_hostname_for_tls(monkeypatch):
    from unittest.mock import Mock

    from backend.core.flows.http_guard import _PublicHTTPSConnection

    _public_dns(monkeypatch)
    sock = Mock()
    monkeypatch.setattr(socket, "socket", lambda *args: sock)
    connection = _PublicHTTPSConnection("api.github.com", timeout=7)
    wrapped = Mock(return_value=sock)
    monkeypatch.setattr(connection._context, "wrap_socket", wrapped)
    connection.connect()
    sock.connect.assert_called_once_with(("93.184.216.34", 443))
    sock.settimeout.assert_called_once_with(7)
    wrapped.assert_called_once_with(sock, server_hostname="api.github.com")
    assert connection._context.check_hostname is True
