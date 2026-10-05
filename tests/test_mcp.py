"""Pruebas del subsistema MCP: registro de servidores, cliente stdio/HTTP y nodo mcp_call."""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from backend.core.flows import mcp_client, mcp_servers, vault
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


def test_add_server_http_requires_tls_or_loopback(mcp_root):
    """CWE-319: http:// a hosts remotos enviaría las credenciales sin cifrar."""
    with pytest.raises(ValueError, match="https"):
        mcp_servers.add_server("Remoto", "http", url="http://mcp.ejemplo.com/mcp")
    with pytest.raises(ValueError, match="https"):
        mcp_servers.add_server("LAN", "http", url="http://192.168.1.10:8000/mcp")
    for url in ("http://127.0.0.1:8000/mcp", "http://localhost:8000/mcp", "http://[::1]:8000/mcp"):
        server = mcp_servers.add_server("Local", "http", url=url)
        assert server["id"]
    assert mcp_servers.add_server("TLS", "http", url="https://mcp.ejemplo.com/mcp")["id"]


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


@pytest.mark.skipif(sys.platform != "win32", reason="La resolución PATHEXT es específica de Windows")
def test_stdio_resolves_cmd_from_path(mcp_root):
    command, args = _fake_stdio(mcp_root)
    shim = mcp_root / "fake-mcp.cmd"
    shim.write_text(f'@"{command}" "{args[0]}" %*\n', encoding="utf-8")
    env = {**os.environ, "PATH": str(mcp_root) + os.pathsep + os.environ.get("PATH", "")}
    tools = mcp_client.list_tools_stdio("fake-mcp", ["argumento con espacios"], env)
    assert [tool["name"] for tool in tools] == ["echo", "boom"]


def test_stdio_roundtrips_utf8_with_non_utf8_locale(mcp_root, monkeypatch):
    popen = mcp_client.subprocess.Popen
    monkeypatch.setattr(
        mcp_client.subprocess, "Popen", lambda *args, **kwargs: popen(*args, **({"encoding": "cp1252"} | kwargs))
    )
    script = mcp_root / "utf8_mcp.py"
    server = _FAKE_SERVER.replace(
        "import json, sys",
        'import json, sys\nsys.stdin.reconfigure(encoding="utf-8")\nsys.stdout.reconfigure(encoding="utf-8")',
    ).replace("json.dumps(out)", "json.dumps(out, ensure_ascii=False)")
    script.write_text(server, encoding="utf-8")
    value = {"texto": "niño 😀"}
    result = mcp_client.call_tool_stdio(sys.executable, [str(script)], dict(os.environ), "echo", value)
    assert json.loads(mcp_client.normalize_result(result)["text"]) == value
    error = mcp_client.call_tool_stdio(sys.executable, [str(script)], dict(os.environ), "boom", {})
    assert mcp_client.normalize_result(error)["text"] == "falló"


def test_stdio_accepts_final_response_before_server_closes(mcp_root):
    script = mcp_root / "closing.py"
    script.write_text(_FAKE_SERVER.replace("sys.stdout.flush()", 'sys.stdout.flush()\n    if method == "tools/list": break'),
                      encoding="utf-8")
    assert [tool["name"] for tool in mcp_client.list_tools_stdio(sys.executable, [str(script)], dict(os.environ))] == ["echo", "boom"]


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


@pytest.mark.parametrize("method", ["tools/list", "tools/call"])
def test_http_initializes_session_before_tool_requests(method):
    seen = []

    class SessionServer(BaseHTTPRequestHandler):
        def do_POST(self):
            msg = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            seen.append(msg)
            current = msg["method"]
            if current == "initialize":
                result = {"protocolVersion": "2025-06-18", "serverInfo": {"name": "session"}}
            else:
                valid_headers = (
                    self.headers.get("Mcp-Session-Id") == "test-session"
                    and self.headers.get("MCP-Protocol-Version") == "2025-06-18"
                    and self.headers.get("Authorization") == "Bearer test"
                )
                if not valid_headers or seen[1]["method"] != "notifications/initialized":
                    self.send_error(400, "La sesión debe inicializarse antes de usar herramientas")
                    return
                if current == "notifications/initialized":
                    self.send_response(202)
                    self.end_headers()
                    return
                result = {"tools": [{"name": "ping"}]} if current == "tools/list" else {"content": []}
            body = json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": result}).encode()
            self.send_response(200)
            self.send_header("Mcp-Session-Id", "test-session")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    httpd = HTTPServer(("127.0.0.1", 0), SessionServer)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        result = mcp_client._http_session_call(
            f"http://127.0.0.1:{httpd.server_port}/mcp", {"Authorization": "Bearer test"}, [(method, {})]
        )
        assert len(result) == 1
        assert [msg["method"] for msg in seen] == ["initialize", "notifications/initialized", method]
        assert "id" not in seen[1]
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_http_secret_headers_not_sent_on_redirect(mcp_root):
    """CWE-200: un redirect no debe reenviar las cabeceras secretas a otro host."""
    seen: list[dict] = []

    class Sink(BaseHTTPRequestHandler):
        def do_POST(self):
            seen.append(dict(self.headers))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *args):
            pass

    sink = HTTPServer(("127.0.0.1", 0), Sink)
    threading.Thread(target=sink.serve_forever, daemon=True).start()

    class Redirect(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length") or 0)
            self.rfile.read(length)
            self.send_response(302)
            self.send_header("Location", f"http://127.0.0.1:{sink.server_port}/mcp")
            self.end_headers()

        def log_message(self, *args):
            pass

    redir = HTTPServer(("127.0.0.1", 0), Redirect)
    threading.Thread(target=redir.serve_forever, daemon=True).start()
    try:
        with pytest.raises(mcp_client.McpError, match="redire"):
            mcp_client.list_tools_http(
                f"http://127.0.0.1:{redir.server_port}/mcp",
                {"Authorization": "Bearer secreto"},
            )
        assert seen == []
    finally:
        redir.shutdown()
        sink.shutdown()


def test_agent_tool_name_roundtrip(mcp_root):
    mcp_servers.add_server("github", "stdio", command="x")
    name = mcp_servers.agent_tool_name("github", "repos.get")
    # el punto no es válido como function name de OpenAI/Anthropic
    assert name.startswith(mcp_servers.agent_tool_name("github", "") + "repos-get-")
    assert mcp_servers.parse_agent_tool(name) == ("github", name[len(mcp_servers.agent_tool_name("github", "")):])
    assert mcp_servers.parse_agent_tool("flows_list") is None
    assert mcp_servers.parse_agent_tool("mcp__solo") is None
    # Todos llevan identidad estable, incluso si comparten un alias antiguo.
    assert mcp_servers.agent_tool_name("s", "ping").startswith(mcp_servers.agent_tool_name("s", "") + "ping-")
    assert len(mcp_servers.agent_tool_name("s" * 60, "t" * 60)) <= 64


def test_call_tool_resolves_advertised_name(mcp_root, monkeypatch):
    """El agente invoca el nombre saneado (repos-get); call_tool traduce al real."""
    monkeypatch.setattr(
        mcp_servers, "list_tools", lambda sid, **kw: [{"name": "repos.get", "description": ""}]
    )
    mcp_servers.add_server("Gh", "stdio", command="x")
    seen = {}
    monkeypatch.setattr(
        mcp_servers.mcp_client,
        "call_tool_stdio",
        lambda command, args, env, tool, tool_args: seen.update(tool=tool) or {"content": []},
    )
    mcp_servers.call_tool("gh", "repos-get", {})
    assert seen["tool"] == "repos.get"


def test_advertised_names_do_not_collide_and_old_ambiguous_approvals_fail_closed(mcp_root, monkeypatch):
    tools = [{"name": name} for name in ("repos.get", "repos-get", "x" * 80 + ".a", "x" * 80 + ".b")]
    monkeypatch.setattr(mcp_servers, "list_tools", lambda sid: tools)
    names = [mcp_servers.agent_tool_name("gh", tool["name"]) for tool in tools]
    assert len(set(names)) == 4 and all(len(name) <= 64 for name in names)
    for tool, name in zip(tools, names, strict=True):
        assert mcp_servers._resolve_tool_name("gh", name, advertised=True) == tool["name"]
    assert mcp_servers._resolve_tool_name("gh", "repos-get") == "repos-get"
    with pytest.raises(ValueError, match="ambiguo"):
        mcp_servers._resolve_tool_name("gh", "mcp__gh__repos-get", advertised=True)
    with pytest.raises(ValueError, match="disponible"):
        mcp_servers._resolve_tool_name("gh", "mcp__gh__removed", advertised=True)


def test_long_server_ids_and_embedded_separator_roundtrip(mcp_root):
    for server_id in ("a" * 64, "a__b"):
        server = mcp_servers.add_server(server_id, "stdio", command="x")
        name = mcp_servers.agent_tool_name(server["id"], "tool")
        assert len(name) <= 64
        assert mcp_servers.parse_agent_tool(name)[0] == server["id"]
    assert mcp_servers.agent_tool_name("a" * 63 + "b", "tool") != mcp_servers.agent_tool_name("a" * 63 + "c", "tool")
    long_id = "s" * 48
    old_alias = long_id[:19] + "-" + mcp_servers.hashlib.sha256(long_id.encode()).hexdigest()[:12]
    assert mcp_servers.agent_tool_name(long_id, "tool") != mcp_servers.agent_tool_name(old_alias, "tool")
    mcp_servers.add_server("a", "stdio", command="x")
    with pytest.raises(ValueError, match="ambiguo"):
        mcp_servers.parse_agent_tool("mcp__a__b__tool")


def test_mcp_retains_argument_schema_and_structured_results(mcp_root, monkeypatch):
    schema = {"type": "object", "properties": {"filter": {"type": "object"}}, "required": ["filter"]}
    server = mcp_servers.add_server("Structured", "stdio", command="x")
    monkeypatch.setattr(mcp_client, "list_tools_stdio", lambda *args: [{"name": "find", "inputSchema": schema}])
    assert mcp_servers.list_tools(server["id"])[0]["inputSchema"] == schema
    monkeypatch.setattr(mcp_client, "call_tool_stdio", lambda *args: {"structuredContent": {"rows": [{"id": 1}]}})
    result = mcp_servers.run_mcp_call_node({"config": {"server": server["id"], "tool": "find", "args": {}}}, {})
    assert result["json"]["structuredContent"] == {"rows": [{"id": 1}]}


@pytest.mark.parametrize("mode", ["oversize", "flood", "notifications"])
def test_stdio_bounds_frames_pending_messages_and_notification_timeout(mcp_root, monkeypatch, mode):
    monkeypatch.setattr(mcp_client, "_STDIO_TIMEOUT_S", 0.5)
    script = mcp_root / "noisy.py"
    action = {
        "oversize": "sys.stdout.write('{'+('x'*1048576)+'\\n'); sys.stdout.flush(); time.sleep(5)",
        "flood": "sys.stdout.write((json.dumps({'method':'notification'})+'\\n')*50000); sys.stdout.flush(); time.sleep(5)",
        "notifications": "while True:\n sys.stdout.write(json.dumps({'method':'notification'})+'\\n'); sys.stdout.flush(); time.sleep(.01)",
    }[mode]
    script.write_text("import sys,time,json\nsys.stdin.readline()\n" + action, encoding="utf-8")
    started = time.monotonic()
    with pytest.raises(mcp_client.McpError, match=r"tamaño máximo|mensajes pendientes|no respondió"):
        mcp_client.list_tools_stdio(sys.executable, [str(script)], dict(os.environ))
    assert time.monotonic() - started < 3


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
