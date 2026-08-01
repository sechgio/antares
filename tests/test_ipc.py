"""IPC integration tests — spawn real Python backend and verify JSON-RPC."""

import json
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

from backend.version import __version__

BACKEND_SCRIPT = Path(__file__).parent.parent / "backend" / "main.py"


def _drain_stderr(proc: subprocess.Popen, sink: list[str]) -> None:
    """Drain stderr so warm-up logs cannot fill the Windows pipe and deadlock IPC."""
    if proc.stderr is None:
        return
    for line in iter(proc.stderr.readline, ""):
        sink.append(line)


@pytest.fixture
def backend_process():
    """Spawn the Python backend and wait for the ready message."""
    project_root = BACKEND_SCRIPT.parent.parent
    proc = subprocess.Popen(
        [sys.executable, "-m", "backend.main"],
        cwd=str(project_root),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )
    stderr_lines: list[str] = []
    threading.Thread(target=_drain_stderr, args=(proc, stderr_lines), daemon=True).start()

    # Wait for ready message (max 10 seconds)
    buffer = ""
    start = time.time()
    while time.time() - start < 10:
        line = proc.stdout.readline()
        if not line:
            continue
        buffer += line
        try:
            msg = json.loads(line)
            if msg.get("method") == "ready":
                break
        except json.JSONDecodeError:
            continue
    else:
        proc.kill()
        pytest.fail(
            f"Backend did not send ready message within 10 seconds.\n"
            f"stdout buffer: {buffer!r}\n"
            f"stderr: {''.join(stderr_lines)!r}",
        )

    yield proc

    # Cleanup
    proc.stdin.close()
    proc.kill()
    proc.wait()


def _rpc_call(proc, method: str, params: dict, timeout: float = 5.0):
    """Send a JSON-RPC request and return the response."""
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

    def test_db_records_shape(self, backend_process) -> None:
        resp = _rpc_call(backend_process, "db_records", {})
        assert "result" in resp
        assert isinstance(resp["result"]["records"], list)
        assert "fields" in resp["result"]

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


