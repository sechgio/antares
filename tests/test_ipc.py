
import json
import os
import sys
import time
from pathlib import Path

import pytest
from PIL import Image

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
    def test_process_start_converts_image_through_rpc(self, tmp_path: Path) -> None:
        source = tmp_path / "entrada.png"
        Image.new("RGB", (8, 8), (23, 45, 67)).save(source)
        destination = tmp_path / "salida"
        env = os.environ.copy()
        if sys.platform == "win32":
            env["LOCALAPPDATA"] = str(tmp_path)
        elif sys.platform == "darwin":
            env["HOME"] = str(tmp_path)
        else:
            env["XDG_DATA_HOME"] = str(tmp_path)
        proc, stderr_lines = spawn_backend(env)

        try:
            await_ready(proc, stderr_lines)
            started = _rpc_call(proc, "process_start", {
                "files": [str(source)],
                "destino": str(destination),
                "formato": "JPEG",
                "usar_rename": False,
            })
            assert started["result"]["started"] is True, started
            job_id = started["result"]["job_id"]

            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                response = _rpc_call(proc, "process_status", {"job_id": job_id})
                assert response["jsonrpc"] == "2.0", response
                status = response["result"]
                if not status["running"]:
                    break
                time.sleep(0.05)
            else:
                pytest.fail("Conversion job did not finish within 15 seconds")

            assert status["total"] == 1
            assert status["result"] == {"ok_count": 1, "err_count": 0, "cancelled": False}
            with Image.open(destination / "entrada.jpg") as converted:
                assert converted.format == "JPEG"
                assert converted.size == (8, 8)
        finally:
            stop_backend(proc)

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


