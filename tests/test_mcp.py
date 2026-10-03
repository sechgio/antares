"""Pruebas del subsistema MCP: registro de servidores, cliente stdio/HTTP y nodo mcp_call."""

from __future__ import annotations

import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from backend.core.flows import mcp_servers, vault
from backend.core.flows.runner import FlowRunner
from backend.core.flows.schema import normalize_graph, validate_graph
from backend.core.flows.store import FlowStore


@pytest.fixture()
def mcp_root(tmp_path, monkeypatch):
    monkeypatch.setattr(mcp_servers, "user_data_path", lambda rel: tmp_path / rel)
    monkeypatch.setattr(vault, "user_data_path", lambda rel: tmp_path / rel)
    return tmp_path


@pytest.fixture()
def store(tmp_path):
    return FlowStore(tmp_path / "flows.json", tmp_path / "flow_runs.json")


_FAKE_SERVER = """
import json, sys

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    msg = json.loads(line)
    mid = msg.get("id")
    if mid is None:
        continue  # notifications/initialized
    method = msg.get("method")
    if method == "initialize":
        out = {"jsonrpc": "2.0", "id": mid, "result": {"protocolVersion": "2024-11-05", "serverInfo": {"name": "fake", "version": "0"}}}
    elif method == "tools/list":
        out = {"jsonrpc": "2.0", "id": mid, "result": {"tools": [{"name": "echo", "description": "Devuelve los args"}, {"name": "boom"}]}}
    elif method == "tools/call":
        params = msg.get("params") or {}
        if params.get("name") == "boom":
            out = {"jsonrpc": "2.0", "id": mid, "result": {"isError": True, "content": [{"type": "text", "text": "falló"}]}}
        else:
            out = {"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": json.dumps(params.get("arguments") or {})}]}}
    else:
        out = {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "unknown"}}
    sys.stdout.write(json.dumps(out) + "\\n")
    sys.stdout.flush()
"""


def _fake_stdio(mcp_root):
    script = mcp_root / "fake_mcp.py"
    script.write_text(_FAKE_SERVER, encoding="utf-8")
    return str(sys.executable), [str(script)]


def test_add_and_list_servers(mcp_root):
    server = mcp_servers.add_server(
        "GitHub",
        "stdio",
        command="npx",
        args=["-y", "@modelcontextprotocol/server-github"],
        secrets={"env": {"GITHUB_TOKEN": "secreto"}},
    )
    assert server["id"] == "github"
    assert server["secret_keys"] == ["GITHUB_TOKEN"]
    listed = mcp_servers.list_servers()
    assert len(listed) == 1
    assert listed[0]["args"] == ["-y", "@modelcontextprotocol/server-github"]
    # el secreto nunca aparece en el listado público
    assert "secreto" not in json.dumps(listed)


def test_add_server_validates(mcp_root):
    with pytest.raises(ValueError, match="transport"):
        mcp_servers.add_server("X", "ws")
    with pytest.raises(ValueError, match="http"):
        mcp_servers.add_server("X", "http", url="ftp://x")
    with pytest.raises(ValueError, match="comando"):
        mcp_servers.add_server("X", "stdio")


def test_remove_server_deletes_secrets(mcp_root):
    server = mcp_servers.add_server("S", "stdio", command="x", secrets={"env": {"K": "v"}})
    secrets_path = mcp_root / "mcp" / f"{server['id']}-secrets.json"
    assert secrets_path.exists()
    mcp_servers.remove_server(server["id"])
    assert mcp_servers.list_servers() == []
    assert not secrets_path.exists()


def test_stdio_tools_list_and_call(mcp_root):
    command, args = _fake_stdio(mcp_root)
    server = mcp_servers.add_server("Fake", "stdio", command=command, args=args, secrets={"env": {"TOKEN": "x"}})
    tools = mcp_servers.list_tools(server["id"])
    assert [t["name"] for t in tools] == ["echo", "boom"]
    result = mcp_servers.call_tool(server["id"], "echo", {"hola": 1})
    assert result["isError"] is False
    assert json.loads(result["text"]) == {"hola": 1}
    err = mcp_servers.call_tool(server["id"], "boom", {})
    assert err["isError"] is True


class _FakeHttpHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        msg = json.loads(self.rfile.read(length) or b"{}")
        method = msg.get("method")
        if method == "initialize":
            result = {"protocolVersion": "2024-11-05", "serverInfo": {"name": "fake-http"}}
        elif method == "tools/list":
            result = {"tools": [{"name": "ping", "description": "pong"}]}
        elif method == "tools/call":
            result = {"content": [{"type": "text", "text": "pong"}]}
        else:
            result = {"content": []}
        body = json.dumps({"jsonrpc": "2.0", "id": msg.get("id"), "result": result}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def test_http_tools_list_and_call(mcp_root):
    httpd = HTTPServer(("127.0.0.1", 0), _FakeHttpHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_port}/mcp"
        server = mcp_servers.add_server("FakeHTTP", "http", url=url, secrets={"headers": {"Authorization": "Bearer t"}})
        assert [t["name"] for t in mcp_servers.list_tools(server["id"])] == ["ping"]
        assert mcp_servers.call_tool(server["id"], "ping", {})["text"] == "pong"
    finally:
        httpd.shutdown()


def test_agent_tool_name_roundtrip(mcp_root):
    name = mcp_servers.agent_tool_name("github", "repos.get")
    assert name == "mcp__github__repos.get"
    assert mcp_servers.parse_agent_tool(name) == ("github", "repos.get")
    assert mcp_servers.parse_agent_tool("flows_list") is None
    assert mcp_servers.parse_agent_tool("mcp__solo") is None


def _wait(run_id: str, store: FlowStore, timeout: float = 10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = store.get_run(run_id)
        if run is not None and run["status"] not in ("queued", "running"):
            return run
        time.sleep(0.05)
    raise AssertionError("run did not finish")


def test_validate_graph_mcp_call(mcp_root):
    graph = normalize_graph(
        {
            "nodes": [
                {"id": "t", "kind": "trigger", "config": {}},
                {"id": "m", "kind": "mcp_call", "config": {"server": "s", "tool": "t"}},
            ],
            "edges": [{"from_node": "t", "to_node": "m"}],
        }
    )
    validate_graph(graph)
    bad = normalize_graph(
        {
            "nodes": [
                {"id": "t", "kind": "trigger", "config": {}},
                {"id": "m", "kind": "mcp_call", "config": {"server": "s"}},
            ],
            "edges": [{"from_node": "t", "to_node": "m"}],
        }
    )
    with pytest.raises(ValueError, match=r"config\.tool"):
        validate_graph(bad)


def test_runner_mcp_call_node(mcp_root, store):
    command, args = _fake_stdio(mcp_root)
    server = mcp_servers.add_server("Fake", "stdio", command=command, args=args)
    flow = store.create(
        "MCP",
        graph={
            "nodes": [
                {"id": "t", "kind": "trigger", "config": {}},
                {
                    "id": "m",
                    "kind": "mcp_call",
                    "config": {"server": server["id"], "tool": "echo", "args": {"valor": "=run.trigger.n"}},
                },
            ],
            "edges": [{"from_node": "t", "to_node": "m"}],
        },
    )
    runner = FlowRunner(store, lambda m: lambda p: {})
    run = runner.start(flow["id"], {"n": 7})
    finished = _wait(run["id"], store)
    assert finished["status"] == "success"
    steps = {s["node_id"]: s for s in finished["steps"]}
    assert steps["m"]["status"] == "success"
    assert json.loads(steps["m"]["output"]["text"]) == {"valor": 7}
