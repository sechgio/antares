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

from backend.utils.validators import is_path_like_key, is_safe_user_path

logger = logging.getLogger(__name__)

_stdout_lock = threading.Lock()

# Maximum allowed payload size for IPC messages (10MB)
# Prevents buffer overflow and pipe blocking with large payloads
_MAX_PAYLOAD_SIZE = 10 * 1024 * 1024


def validate_method(method: str) -> bool:
    """Validate that method name is alphanumeric with underscores only."""
    if not method or not isinstance(method, str):
        return False
    return bool(re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", method))


def validate_params(params: dict) -> bool:
    """Validate params dict for basic safety.

    Uses the single shared heuristic (is_path_like_key) from validators.
    This is defense-in-depth — the handler @validate_params decorator remains
    the authoritative layer. We still apply the key-name heuristic here so that
    handlers using non-canonical keys (e.g. ``output_path``) get an early
    path-traversal screen at the IPC boundary.
    """
    if not isinstance(params, dict):
        return False

    for key, value in params.items():
        if value is None:
            continue
        if not is_path_like_key(key):
            continue
        if isinstance(value, list):
            for item in value:
                if not is_safe_user_path(item):
                    return False
        elif not is_safe_user_path(value):
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
    """Escribe una respuesta JSON-RPC a stdout. Nunca levanta excepción."""
    payload: dict[str, Any] = {
        "jsonrpc": "2.0",
        "id": msg_id,
    }
    if error:
        payload["error"] = {"code": -32000, "message": error}
    else:
        payload["result"] = result
    try:
        json_str = json.dumps(payload, ensure_ascii=False, default=_json_default)
        # Validate payload size before sending
        if len(json_str.encode('utf-8')) > _MAX_PAYLOAD_SIZE:
            logger.error("Response payload too large: %d bytes (max: %d)", len(json_str), _MAX_PAYLOAD_SIZE)
            # Send error response instead of oversized payload
            error_payload = {
                "jsonrpc": "2.0",
                "id": msg_id,
                "error": {"code": -32001, "message": f"Response too large ({len(json_str)} bytes)"}
            }
            json_str = json.dumps(error_payload, ensure_ascii=False)
        with _stdout_lock:
            sys.stdout.write(json_str + "\n")
            sys.stdout.flush()
    except Exception as exc:
        # If stdout is broken (e.g., Electron closed the pipe), log to stderr
        # but DO NOT crash the backend process.
        logger.error("Failed to write response to stdout: %s", exc)


def send_notification(method: str, params: dict[str, Any]) -> None:
    """Escribe una notificación (sin id) a stdout — usada para progreso. Nunca levanta excepción."""
    payload = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    }
    try:
        json_str = json.dumps(payload, ensure_ascii=False, default=_json_default)
        # Validate payload size before sending
        if len(json_str.encode('utf-8')) > _MAX_PAYLOAD_SIZE:
            logger.error("Notification payload too large: %d bytes (max: %d), dropping", len(json_str), _MAX_PAYLOAD_SIZE)
            return  # Drop oversized notifications to prevent pipe blocking
        with _stdout_lock:
            sys.stdout.write(json_str + "\n")
            sys.stdout.flush()
    except Exception as exc:
        # If stdout is broken, log to stderr but DO NOT crash the backend.
        logger.error("Failed to write notification to stdout: %s", exc)


def _json_default(obj: Any) -> Any:
    if isinstance(obj, Path):
        return str(obj)
    msg = f"Object of type {type(obj).__name__} is not JSON serializable"
    raise TypeError(msg)


# Sentinel returned on parse errors (not EOF)
_SKIP = object()


def read_message() -> IPCMessage | None:
    """Lee una línea JSON desde stdin. Returns None on EOF, _SKIP on parse error.

    Parse errors are logged to stderr (no response is sent) because the
    request id is unknown and an `id=None` response cannot be correlated
    by the IPC router on the renderer side — it would just be discarded
    and the caller would block until its own timeout.
    """
    try:
        line = sys.stdin.readline()
        if not line:
            return None  # EOF — pipe closed
        data = json.loads(line)
        # Try to recover an id from the partially-parsed payload so the
        # frontend can correlate the error response with the original request.
        msg_id = data.get("id") if isinstance(data, dict) else None
        try:
            return IPCMessage(data)
        except ValueError as exc:
            # Malformed message but we know the id → send a proper error response.
            if msg_id is not None:
                send_response(None, msg_id, error=str(exc))
            else:
                logger.error("Invalid IPC message with no id: %s", exc)
            return _SKIP  # type: ignore[return-value]
    except json.JSONDecodeError as exc:
        # Cannot correlate to any request → log only, do not send orphan response.
        logger.error("JSON inválido en stdin: %s", exc)
        return _SKIP  # type: ignore[return-value]
    except Exception:
        logger.error("Error leyendo stdin: %s", traceback.format_exc())
        return _SKIP  # type: ignore[return-value]
