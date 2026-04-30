"""Protocolo IPC via stdin/stdout JSON-RPC.

El backend lee líneas JSON desde stdin, procesa y escribe respuestas JSON a stdout.
Cada línea es un mensaje completo.
"""

from __future__ import annotations

import json
import logging
import re
import sys
import traceback
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def validate_method(method: str) -> bool:
    """Validate that method name is alphanumeric with underscores only."""
    if not method or not isinstance(method, str):
        return False
    return bool(re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', method))


def validate_params(params: dict) -> bool:
    """Validate params dict for basic safety."""
    if not isinstance(params, dict):
        return False

    # Check for path traversal attempts
    params_str = json.dumps(params)
    return not ('../' in params_str or '..\\' in params_str)

# ─── IPC Protocol ────────────────────────────────────────────────────────────

class IPCMessage:
    """Mensaje IPC entrante."""

    def __init__(self, raw: dict[str, Any]) -> None:
        self.id: str | int = raw.get("id", "")
        self.method: str = raw.get("method", "")
        self.params: dict[str, Any] = raw.get("params", {})

        # Validate
        if not validate_method(self.method):
            raise ValueError(f"Invalid method name: {self.method}")
        if not validate_params(self.params):
            raise ValueError("Invalid params: possible path traversal detected")

    def __repr__(self) -> str:
        return f"IPCMessage(id={self.id}, method={self.method})"


def send_response(result: Any, msg_id: str | int, *, error: str | None = None) -> None:
    """Escribe una respuesta JSON-RPC a stdout."""
    payload: dict[str, Any] = {
        "jsonrpc": "2.0",
        "id": msg_id,
    }
    if error:
        payload["error"] = {"code": -32000, "message": error}
    else:
        payload["result"] = result
    json_str = json.dumps(payload, ensure_ascii=False, default=_json_default)
    sys.stdout.write(json_str + '\n')
    sys.stdout.flush()


def send_notification(method: str, params: dict[str, Any]) -> None:
    """Escribe una notificación (sin id) a stdout — usada para progreso."""
    payload = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    }
    print(json.dumps(payload, ensure_ascii=False, default=_json_default))
    sys.stdout.flush()


def _json_default(obj: Any) -> Any:
    if isinstance(obj, Path):
        return str(obj)
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def read_message() -> IPCMessage | None:
    """Lee una línea JSON desde stdin."""
    try:
        line = sys.stdin.readline()
        if not line:
            return None
        data = json.loads(line)
        return IPCMessage(data)
    except json.JSONDecodeError:
        send_response(None, 0, error="JSON inválido")
        return None
    except Exception:
        send_response(None, 0, error=f"Error leyendo stdin: {traceback.format_exc()}")
        return None
