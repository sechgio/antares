from __future__ import annotations

import json
import sys
import threading
import time

import pytest

from backend.core.agent import agent_chat
from backend.core.integrations import mcp_client, mcp_servers


def test_http_pagination_uses_one_session_and_unique_ids(monkeypatch):
    seen = []

    def post(url, headers, payload):
        seen.append((headers, payload))
        method = payload["method"]
        if method == "initialize":
            return {"result": {"protocolVersion": "2025-06-18"}}, "session"
        if method == "notifications/initialized":
            return {}, None
        result = {"tools": [{"name": "first"}], "nextCursor": "next"} if not payload["params"] else {"tools": [{"name": "second"}]}
        return {"id": payload["id"], "result": result}, None

    monkeypatch.setattr(mcp_client, "_http_post", post)
    assert [tool["name"] for tool in mcp_client.list_tools_http("http://localhost/mcp", {})] == ["first", "second"]
    assert [payload["id"] for _, payload in seen if payload["method"] == "tools/list"] == [1, 2]
    assert seen[-1][0]["Mcp-Session-Id"] == "session"
    assert seen[-1][1]["params"] == {"cursor": "next"}


@pytest.mark.parametrize("pages, message", [
    ([{"tools": [], "nextCursor": "same"}] * 2, "repetido"),
    ([{"tools": [{"name": "x"}], "nextCursor": "next"}, {"tools": [{"name": "x"}]}], "duplicados"),
    ([{"tools": [{"name": "x", "inputSchema": {"type": "string"}}]}], "Schema"),
    ([{"tools": [{"name": str(i)} for i in range(513)]}], "512"),
])
def test_invalid_catalogs_fail_without_advertising_partial_tools(pages, message):
    iterator = iter(pages)
    with pytest.raises(mcp_client.McpError, match=message):
        mcp_client._tool_pages(lambda params: next(iterator))


def test_stdio_pagination_and_cancel_terminate_the_child(tmp_path):
    script = tmp_path / "server.py"
    script.write_text('''import json, sys, time
for line in sys.stdin:
    msg = json.loads(line)
    if "id" not in msg: continue
    method = msg["method"]
    if method == "initialize": result = {"protocolVersion": "2024-11-05"}
    elif method == "tools/list":
        result = {"tools": [{"name": "b"}]} if msg["params"] else {"tools": [{"name": "a"}], "nextCursor": "2"}
    else:
        time.sleep(30)
        result = {"content": []}
    print(json.dumps({"id": msg["id"], "result": result}), flush=True)
''', encoding="utf-8")
    env = mcp_servers._stdio_env({})
    assert [tool["name"] for tool in mcp_client.list_tools_stdio(sys.executable, [str(script)], env)] == ["a", "b"]
    cancel = threading.Event()
    timer = threading.Timer(0.5, cancel.set)
    timer.start()
    started = time.monotonic()
    try:
        with pytest.raises(mcp_client.McpCancelled):
            mcp_client.call_tool_stdio(sys.executable, [str(script)], env, "a", {}, cancelled=cancel.is_set)
        assert time.monotonic() - started < 5
    finally:
        timer.cancel()


def test_http_cancel_notifies_the_same_request(monkeypatch):
    entered, cancelled, notified, release = (threading.Event() for _ in range(4))

    def post(url, headers, payload):
        if payload["method"] == "initialize":
            return {"result": {"protocolVersion": "2025-06-18"}}, "session"
        if payload["method"] == "tools/call":
            entered.set()
            release.wait(5)
            return {"id": 1, "result": {"content": []}}, None
        if payload["method"] == "notifications/cancelled":
            assert payload["params"]["requestId"] == 1 and headers["Mcp-Session-Id"] == "session"
            notified.set()
        return {}, None

    monkeypatch.setattr(mcp_client, "_http_post", post)
    timer = threading.Timer(0.2, cancelled.set)
    timer.start()
    try:
        with pytest.raises(mcp_client.McpCancelled):
            mcp_client.call_tool_http("http://localhost/mcp", {}, "write", {}, cancelled=cancelled.is_set)
        assert entered.is_set() and notified.wait(2)
    finally:
        release.set()
        timer.cancel()


def test_selection_persists_and_rejects_old_calls(tmp_path, monkeypatch):
    monkeypatch.setattr(mcp_servers, "user_data_path", lambda name: tmp_path / name)
    monkeypatch.setattr(mcp_servers, "_secrets", lambda server: {})
    monkeypatch.setattr(mcp_servers, "_tools_cache", {})
    monkeypatch.setattr(mcp_client, "list_tools_http", lambda *args: [{"name": "read", "inputSchema": {"type": "object"}}])
    called = []
    monkeypatch.setattr(mcp_client, "call_tool_http", lambda *args: called.append(args) or {"content": []})
    server = mcp_servers.add_server("Local", "http", url="http://localhost/mcp")
    name = mcp_servers.agent_tool_name(server["id"], "read")
    assert name in {tool["name"] for tool in agent_chat.tool_specs()}
    mcp_servers.set_tool_enabled(server["id"], "read", False)
    assert name not in {tool["name"] for tool in agent_chat.tool_specs()}
    assert mcp_servers.list_tools(server["id"])[0]["enabled"] is False
    with pytest.raises(ValueError, match="deshabilitada"):
        mcp_servers.call_tool(server["id"], name, {}, advertised=True)
    assert called == []
    mcp_servers.set_tool_enabled(server["id"], "read", True)
    mcp_servers.call_tool(server["id"], name, {}, advertised=True)
    assert len(called) == 1


def test_failed_mcp_response_is_uncertain_and_is_not_dispatched_again(tmp_path, monkeypatch):
    from backend.core.agent import agent
    from backend.handlers import agent_internal

    monkeypatch.setattr(mcp_servers, "user_data_path", lambda name: tmp_path / name)
    monkeypatch.setattr(mcp_servers, "_secrets", lambda server: {})
    monkeypatch.setattr(mcp_servers, "_tools_cache", {})
    monkeypatch.setattr(mcp_client, "list_tools_http", lambda *args: [{"name": "write", "inputSchema": {"type": "object"}}])
    effects = []

    def timeout(url, headers, payload):
        if payload["method"] == "tools/call":
            effects.append("sent")
            raise mcp_client.McpError("El servidor no respondió")
        return {"result": {"protocolVersion": "2025-06-18"}}, None

    monkeypatch.setattr(mcp_client, "_http_post", timeout)
    server = mcp_servers.add_server("Local", "http", url="http://localhost/mcp")
    method = mcp_servers.agent_tool_name(server["id"], "write")
    store = agent.AgentStore(tmp_path / "agent")
    runner = agent.AgentRunner(store, lambda _: None)
    monkeypatch.setattr(agent_internal._agent, "get_agent_store", lambda: store)
    monkeypatch.setattr(agent_internal._agent, "get_agent_runner", lambda: runner)
    approval = agent_internal._approval_ensure({"session_id": "s1", "call_id": "c1", "method": method, "params": {}})["approval"]
    agent_internal._approval_decide({"approval_id": approval["id"], "approve": True})
    request = {"session_id": "s1", "call_id": "c1", "name": method, "params": {}, "approval_id": approval["id"]}
    result = agent_internal._dispatch(request)
    deadline = time.monotonic() + 5
    while result["result"] is None and time.monotonic() < deadline:
        time.sleep(0.02)
        result = agent_internal._dispatch_result({"session_id": "s1", "call_id": "c1"})
    assert json.loads(result["result"])["error"]
    assert store.get_dispatch("s1", "c1")["status"] == "uncertain"
    assert agent_internal._dispatch(request)["result"] == result["result"]
    assert effects == ["sent"]


def test_mcp_initialization_failure_and_server_error_are_confirmed_failures(monkeypatch):
    def init_error(*args):
        raise mcp_client.McpError("Inicialización fallida")
    monkeypatch.setattr(mcp_client, "_http_post", init_error)
    with pytest.raises(mcp_client.McpError) as failed:
        mcp_client.call_tool_http("http://localhost/mcp", {}, "write", {})
    assert not isinstance(failed.value, mcp_client.McpUncertain)

    def server_error(url, headers, payload):
        return ({"error": {"message": "Llamada rechazada"}} if payload["method"] == "tools/call" else {"result": {}}), None
    monkeypatch.setattr(mcp_client, "_http_post", server_error)
    with pytest.raises(mcp_client.McpError) as rejected:
        mcp_client.call_tool_http("http://localhost/mcp", {}, "write", {})
    assert not isinstance(rejected.value, mcp_client.McpUncertain)
