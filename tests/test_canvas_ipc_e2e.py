
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

from tests.conftest import await_ready, spawn_backend, stop_backend


def _user_data_env(tmp_path: Path) -> dict[str, str]:
    env = os.environ.copy()
    if sys.platform == "win32":
        env["LOCALAPPDATA"] = str(tmp_path)
    elif sys.platform == "darwin":
        env["HOME"] = str(tmp_path)
    else:
        env["XDG_DATA_HOME"] = str(tmp_path)
    return env


@pytest.fixture
def backend(tmp_path: Path):
    proc, stderr_lines = spawn_backend(_user_data_env(tmp_path))
    await_ready(proc, stderr_lines)
    yield proc, stderr_lines
    stop_backend(proc)


def _rpc_call(proc: subprocess.Popen, method: str, params: dict, timeout: float = 5.0) -> dict:
    req_id = str(int(time.time() * 1000))
    request = {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params}
    proc.stdin.write(json.dumps(request) + "\n")
    proc.stdin.flush()

    start = time.time()
    while time.time() - start < timeout:
        line = proc.stdout.readline()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if msg.get("id") == req_id:
            return msg
    pytest.fail(f"No response for {method} within {timeout}s")


def _text_layer(layer_id: str, name: str, value: str) -> dict:
    return {
        "id": layer_id,
        "type": "text",
        "name": name,
        "value": value,
        "locked": False,
        "cssVars": {
            "--width": "40mm",
            "--height": "10mm",
            "--translate-x": "10mm",
            "--translate-y": "10mm",
        },
    }


class TestCanvasIpcE2E:

    def test_canvas_full_crud_roundtrip(self, backend) -> None:
        proc, _stderr = backend

        resp = _rpc_call(proc, "canvas_create", {"name": "E2E"})
        assert "result" in resp, resp
        doc = resp["result"]["document"]
        doc_id = doc["id"]
        assert doc["name"] == "E2E"
        assert doc["version"] == 2

        doc["layers"].append(_text_layer("e2e-layer-1", "Hola", "Hola mundo"))
        resp = _rpc_call(proc, "canvas_save", {"document": doc})
        assert "result" in resp, resp
        saved = resp["result"]["document"]
        assert saved["id"] == doc_id
        assert any(lyr["id"] == "e2e-layer-1" for lyr in saved["layers"])

        resp = _rpc_call(proc, "canvas_list", {})
        assert "result" in resp, resp
        items = resp["result"]["documents"]
        assert len(items) == 1
        assert items[0]["id"] == doc_id
        assert items[0]["name"] == "E2E"

        resp = _rpc_call(proc, "canvas_get", {"id": doc_id})
        assert "result" in resp, resp
        fetched = resp["result"]["document"]
        assert fetched["id"] == doc_id
        assert any(lyr["id"] == "e2e-layer-1" for lyr in fetched["layers"])

        resp = _rpc_call(proc, "canvas_duplicate", {"id": doc_id})
        assert "result" in resp, resp
        dup = resp["result"]["document"]
        dup_id = dup["id"]
        assert dup_id != doc_id
        assert dup["name"].startswith("E2E")
        assert any(lyr["type"] == "text" for lyr in dup["layers"])

        resp = _rpc_call(proc, "canvas_list", {})
        assert "result" in resp, resp
        ids = {d["id"] for d in resp["result"]["documents"]}
        assert ids == {doc_id, dup_id}

        resp = _rpc_call(proc, "canvas_delete", {"id": doc_id})
        assert "result" in resp, resp
        assert resp["result"]["success"] is True
        assert resp["result"]["deleted_id"] == doc_id

        resp = _rpc_call(proc, "canvas_get", {"id": doc_id})
        assert "error" in resp, resp

        resp = _rpc_call(proc, "canvas_list", {})
        assert "result" in resp, resp
        remaining = resp["result"]["documents"]
        assert len(remaining) == 1
        assert remaining[0]["id"] == dup_id

        resp = _rpc_call(proc, "canvas_delete", {"id": dup_id})
        assert "result" in resp, resp
        assert resp["result"]["success"] is True

        resp = _rpc_call(proc, "canvas_list", {})
        assert "result" in resp, resp
        assert resp["result"]["documents"] == []
