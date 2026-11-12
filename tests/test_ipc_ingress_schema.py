"""Contrato de validación de params en el ingress del backend (ipc-bridge-006).

El catálogo compartido declara inputSchema por método; desde este lote el
dispatcher de backend/main.py lo impone antes de despachar (cubre también el
salto de argumentos LLM de native:agent). Estos tests fijan el contrato:
los schemas declarados compilan, los métodos sin schema no se tocan y las
violaciones se rechazan con VALIDATION_ERROR sin ejecutar el handler.
"""

from __future__ import annotations

import itertools
import json
import os
import time

from jsonschema import Draft202012Validator

from backend.core import ipc_catalog
from backend.core.ipc_catalog import validate_params_schema
from tests.conftest import await_ready, spawn_backend, stop_backend

_counter = itertools.count()


def _rpc_call(proc, method: str, params: dict, timeout: float = 8.0):
    req_id = f"schema-{next(_counter)}-{int(time.time() * 1000)}"
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
    raise AssertionError(f"No response for {method} within {timeout}s")


def test_every_declared_input_schema_compiles_under_draft_2020_12() -> None:
    fails: list[str] = []
    for name, entry in ipc_catalog._METHODS.items():
        schema = entry.get("inputSchema")
        if not schema:
            continue
        try:
            Draft202012Validator(schema)
        except Exception as exc:
            fails.append(f"{name}: {exc}")
    assert fails == [], "schemas de catálogo que no compilan:\n" + "\n".join(fails)


def test_methods_without_schema_or_unknown_are_not_enforced() -> None:
    assert ipc_catalog._entry("agent_sessions_list") is not None
    assert validate_params_schema("agent_sessions_list", {"title": 5, "extra": True}) is None
    assert validate_params_schema("metodo_que_no_existe", {"zzz": 1}) is None
    assert validate_params_schema("metodo_que_no_existe", None) is None


def test_valid_and_invalid_params_for_declared_schemas() -> None:
    assert validate_params_schema("agent_tasks_cancel", {"id": "tx-1"}) is None
    missing = validate_params_schema("agent_tasks_cancel", {})
    assert missing is not None and "id" in missing

    bad_enum = validate_params_schema(
        "agent_artifact_action",
        {"session_id": "s", "artifact_id": "a", "action": "detonar"},
    )
    assert bad_enum is not None and "agent_artifact_action" in bad_enum

    negative = validate_params_schema(
        "agent_artifact_action",
        {"session_id": "s", "artifact_id": "a", "action": "preview", "file_index": -1},
    )
    assert negative is not None

    extra = validate_params_schema("agent_session_rules_set", {"id": "s", "rules": {"zzz": "allow"}})
    assert extra is not None

    rules_ok = validate_params_schema("agent_session_rules_set", {"id": "s", "rules": {"terminal": "ask"}})
    assert rules_ok is None


def test_invalid_params_rejected_before_dispatch_at_the_real_backend() -> None:
    env = os.environ.copy()
    proc, stderr_lines = spawn_backend(env)
    try:
        await_ready(proc, stderr_lines)

        missing = _rpc_call(proc, "agent_tasks_cancel", {})
        error = missing.get("error") or {}
        assert error.get("code") == -32602, f"error={error}"
        assert error.get("category") == "VALIDATION_ERROR", f"error={error}"
        assert "agent_tasks_cancel" in error.get("message", "")

        bad_enum = _rpc_call(
            proc,
            "agent_artifact_action",
            {"session_id": "s", "artifact_id": "a", "action": "detonar"},
        )
        assert (bad_enum.get("error") or {}).get("code") == -32602

        accepted = _rpc_call(proc, "agent_tasks_cancel", {"id": "tx-inexistente-1"})
        accepted_error = accepted.get("error") or {}
        assert accepted_error.get("code") != -32602, f"error={accepted_error}"
        assert accepted_error.get("category") != "VALIDATION_ERROR", f"error={accepted_error}"
    finally:
        stop_backend(proc)
