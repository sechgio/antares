
import json
import os
import time

import pytest

from backend.version import __version__
from tests.conftest import await_ready, spawn_backend, stop_backend


def _rpc_call(proc, method: str, params: dict, timeout: float = 5.0):
    req_id = str(int(time.time() * 1000))
    request = {
        "jsonrpc": "2.0",
        "id": req_id,
        "method": method,
        "params": params,
    }
    proc.stdin.write(json.dumps(request) + "\n")
    proc.stdin.flush()

    start = time.time()
    while time.time() - start < timeout:
        line = proc.stdout.readline()
        if not line:
            continue
        try:
            msg = json.loads(line)
            if msg.get("id") == req_id:
                return msg
        except json.JSONDecodeError:
            continue
    pytest.fail(f"No response for {method} within {timeout}s")


def test_oversized_request_does_not_desynchronize_real_backend() -> None:
    env = os.environ.copy()
    env["ANTARES_IPC_MAX_PAYLOAD_SIZE"] = "1024"
    proc, stderr_lines = spawn_backend(env)

    try:
        await_ready(proc, stderr_lines)

        oversized = {
            "jsonrpc": "2.0",
            "id": "too-large-real",
            "method": "version",
            "params": {"data": "x" * 2_000},
        }
        valid = {
            "jsonrpc": "2.0",
            "id": "after-large-real",
            "method": "version",
            "params": {},
        }
        proc.stdin.write(json.dumps(oversized) + "\n" + json.dumps(valid) + "\n")
        proc.stdin.flush()

        responses = {}
        start = time.time()
        while time.time() - start < 10 and len(responses) < 2:
            line = proc.stdout.readline()
            if not line:
                continue
            message = json.loads(line)
            if message.get("id") in {"too-large-real", "after-large-real"}:
                responses[message["id"]] = message

        assert responses["too-large-real"]["error"]["code"] == -32600
        assert responses["after-large-real"]["result"]["version"] == __version__
        assert proc.poll() is None
    finally:
        stop_backend(proc)


class TestIPC:
    def test_version(self, backend_process) -> None:
        resp = _rpc_call(backend_process, "version", {})
        assert "result" in resp
        assert resp["result"]["version"] == __version__

    def test_formats(self, backend_process) -> None:
        resp = _rpc_call(backend_process, "formats", {})
        assert "result" in resp
        formats = resp["result"]["formats"]
        assert "JPEG" in formats
        assert "PNG" in formats
        assert "WEBP" in formats

    def test_db_columns_shape(self, backend_process) -> None:
        resp = _rpc_call(backend_process, "db_columns", {})
        assert "result" in resp
        assert isinstance(resp["result"]["records"], list)
        assert "columns" in resp["result"]

    def test_theme_get(self, backend_process) -> None:
        resp = _rpc_call(backend_process, "theme_get", {})
        assert "result" in resp
        assert "name" in resp["result"]

    def test_history_list_shape(self, backend_process) -> None:
        resp = _rpc_call(backend_process, "history_list", {})
        assert "result" in resp
        assert isinstance(resp["result"]["runs"], list)

    def test_unknown_method(self, backend_process) -> None:
        resp = _rpc_call(backend_process, "nonexistent_method", {})
        assert "error" in resp
        assert resp["error"]["code"] == -32601
        assert resp["error"]["category"] == "METHOD_NOT_FOUND"
        msg = resp["error"]["message"]
        assert "desconocido" in msg.lower() or "unknown" in msg.lower()
        time.sleep(0.15)
        stderr_lines = getattr(backend_process, "stderr_lines", [])
        assert any(
            "backend.ipc.unknown_method" in line and "nonexistent_method" in line
            for line in stderr_lines
        )


