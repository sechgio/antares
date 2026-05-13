"""Protocolo IPC via stdin/stdout JSON-RPC.

El backend lee líneas JSON desde stdin, procesa y escribe respuestas JSON a stdout.
Cada línea es un mensaje completo.
"""

from __future__ import annotations

import json
import logging
import re
import sys
import threading
import traceback
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_stdout_lock = threading.Lock()


def validate_method(method: str) -> bool:
    """Validate that method name is alphanumeric with underscores only."""
    if not method or not isinstance(method, str):
        return False
    return bool(re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", method))


def validate_params(params: dict) -> bool:
    """Validate params dict for basic safety."""
    if not isinstance(params, dict):
        return False

    # Check for path traversal attempts using resolved paths
    for key in ("files", "destino", "path", "folder", "name"):
        value = params.get(key)
        if value is None:
            continue
        if isinstance(value, list):
            for item in value:
                if not _is_path_safe(item):
                    return False
        elif not _is_path_safe(value):
            return False

    return True


def _is_path_safe(value: Any) -> bool:
    """Check if a path value is safe (no traversal, valid string).

    Rejects explicit traversal sequences (``../`` and ``..\\``), null bytes,
    and URL-encoded traversal. Windows absolute paths (e.g. ``C:\\...``) are
    allowed since the Electron layer already constrains path selection via
    native file dialogs.
    """
    if not isinstance(value, str) or not value:
        return True  # Empty/invalid values handled downstream
    # Reject null bytes (used in injection attacks).
    if "\x00" in value:
        return False
    # Reject obvious traversal patterns (both POSIX and Windows separators).
    if "../" in value or "..\\" in value:
        return False
    # Reject URL-encoded traversal patterns (single and double-encoded).
    lowered = value.lower()
    if "%2e%2e" in lowered or "%252e" in lowered:
        return False
    return True

# ─── IPC Protocol ────────────────────────────────────────────────────────────

class IPCMessage:
    """Mensaje IPC entrante."""

    def __init__(self, raw: dict[str, Any]) -> None:
        self.id: str | int = raw.get("id", "")
        self.method: str = raw.get("method", "")
        self.params: dict[str, Any] = raw.get("params", {})

        # Validate
        if not validate_method(self.method):
            msg = f"Invalid method name: {self.method}"
            raise ValueError(msg)
        if not validate_params(self.params):
            msg = "Invalid params: possible path traversal detected"
            raise ValueError(msg)

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
    with _stdout_lock:
        sys.stdout.write(json_str + "\n")
        sys.stdout.flush()


def send_notification(method: str, params: dict[str, Any]) -> None:
    """Escribe una notificación (sin id) a stdout — usada para progreso."""
    payload = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    }
    json_str = json.dumps(payload, ensure_ascii=False, default=_json_default)
    with _stdout_lock:
        sys.stdout.write(json_str + "\n")
        sys.stdout.flush()


def _json_default(obj: Any) -> Any:
    if isinstance(obj, Path):
        return str(obj)
    msg = f"Object of type {type(obj).__name__} is not JSON serializable"
    raise TypeError(msg)


# Sentinel returned on parse errors (not EOF)
_SKIP = object()


def read_message() -> IPCMessage | None:
    """Lee una línea JSON desde stdin. Returns None on EOF, _SKIP on parse error."""
    try:
        line = sys.stdin.readline()
        if not line:
            return None  # EOF — pipe closed
        data = json.loads(line)
        return IPCMessage(data)
    except json.JSONDecodeError:
        send_response(None, 0, error="JSON inválido")
        return _SKIP  # type: ignore[return-value]
    except Exception:
        send_response(None, 0, error=f"Error leyendo stdin: {traceback.format_exc()}")
        return _SKIP  # type: ignore[return-value]
