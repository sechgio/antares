"""Protocolo IPC via stdin/stdout JSON-RPC.

El backend lee líneas JSON desde stdin, procesa y escribe respuestas JSON a stdout.
Cada línea es un mensaje completo.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import threading
import time
import traceback
from datetime import date, datetime
from datetime import time as dt_time
from pathlib import Path
from typing import Any

from backend.core import ipc_phase_telemetry
from backend.core.exceptions import AntaresBaseException, InvalidRequestError, ValidationError
from backend.utils.validators import path_param_violations

logger = logging.getLogger(__name__)

_stdout_lock = threading.Lock()

# Maximum allowed JSON payload size for IPC messages. Large binary exports
# should use direct-to-disk handlers, but previews and metadata can exceed the
# old 10 MB ceiling on high-DPI assets.
_MAX_PAYLOAD_SIZE = int(os.environ.get("ANTARES_IPC_MAX_PAYLOAD_SIZE", str(64 * 1024 * 1024)))


def validate_method(method: str) -> bool:
    """Validate that method name is alphanumeric with underscores only."""
    if not method or not isinstance(method, str):
        return False
    return bool(re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", method))


def validate_params(params: dict) -> bool:
    """Validate params dict for basic safety.

    Defense-in-depth: the handler ``@validate_params`` decorator remains the
    authoritative layer, but we apply the same shared path-screening loop here
    (``path_param_violations``) so handlers using non-canonical keys (e.g.
    ``output_path``) — including those without the decorator — still get an
    early path-traversal screen at the IPC boundary.
    """
    if not isinstance(params, dict):
        return False
    return not any(path_param_violations(params, strict=False))


# ─── IPC Protocol ────────────────────────────────────────────────────────────

class IPCMessage:
    """Mensaje IPC entrante."""

    def __init__(self, raw: dict[str, Any]) -> None:
        self.id: str | int = raw.get("id", "")
        self.method: str = raw.get("method", "")
        self.params: dict[str, Any] = raw.get("params", {})

        if not validate_method(self.method):
            raise InvalidRequestError(f"Invalid method name: {self.method}")
        if not validate_params(self.params):
            raise ValidationError("Invalid params: possible path traversal detected")

    def __repr__(self) -> str:
        return f"IPCMessage(id={self.id}, method={self.method})"


def _emit_stdout_line(payload_bytes: bytes) -> None:
    with _stdout_lock:
        buffer = getattr(sys.stdout, "buffer", None)
        if buffer is not None:
            buffer.write(payload_bytes + b"\n")
            buffer.flush()
            return
        # Text-only test doubles (e.g. io.StringIO) have no binary buffer.
        sys.stdout.write(payload_bytes.decode("utf-8") + "\n")
        sys.stdout.flush()


def send_response(
    result: Any,
    msg_id: str | int,
    *,
    error: Any | None = None,
    error_code: int = -32000,
    error_category: str = "INTERNAL_ERROR",
) -> None:
    """Escribe una respuesta JSON-RPC a stdout. Nunca levanta excepción."""
    payload: dict[str, Any] = {
        "jsonrpc": "2.0",
        "id": msg_id,
    }
    if error is not None:
        if hasattr(error, "to_dict") and callable(getattr(error, "to_dict", None)):
            payload["error"] = error.to_dict()
        elif isinstance(error, dict):
            payload["error"] = error
        else:
            payload["error"] = {
                "code": error_code,
                "message": str(error),
                "category": error_category,
            }
    else:
        payload["result"] = result

    write_ok = False
    t0 = time.perf_counter()
    try:
        # Encode once: size check and write share the same UTF-8 buffer.
        payload_bytes = json.dumps(payload, ensure_ascii=False, default=_json_default).encode("utf-8")
        if len(payload_bytes) > _MAX_PAYLOAD_SIZE:
            logger.error(
                "Response payload too large: %d bytes (max: %d)",
                len(payload_bytes),
                _MAX_PAYLOAD_SIZE,
            )
            # Send error response instead of oversized payload
            error_payload = {
                "jsonrpc": "2.0",
                "id": msg_id,
                "error": {
                    "code": -32001,
                    "message": f"Response too large ({len(payload_bytes)} bytes)",
                },
            }
            payload_bytes = json.dumps(error_payload, ensure_ascii=False).encode("utf-8")
        _emit_stdout_line(payload_bytes)
        write_ok = True
    except Exception as exc:
        # If stdout is broken (e.g., Electron closed the pipe), log to stderr
        # but DO NOT crash the backend process.
        logger.error("Failed to write response to stdout: %s", exc)
    finally:
        if ipc_phase_telemetry.enabled():
            try:
                serialize_ms = (time.perf_counter() - t0) * 1000.0
                ipc_phase_telemetry.mark(msg_id, "serialize_write_end")
                fields: dict[str, Any] = {
                    "serialize_write_ms": serialize_ms,
                    "write_ok": write_ok,
                }
                if error is not None:
                    fields["ok"] = False
                elif write_ok:
                    fields.setdefault("ok", True)
                ipc_phase_telemetry.set_fields(msg_id, **fields)
                ipc_phase_telemetry.emit_and_clear(msg_id)
            except Exception:
                logger.debug("ipc_phase telemetry failed in send_response", exc_info=True)


def send_notification(method: str, params: dict[str, Any]) -> None:
    """Escribe una notificación (sin id) a stdout — usada para progreso. Nunca levanta excepción."""
    payload = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    }
    try:
        payload_bytes = json.dumps(payload, ensure_ascii=False, default=_json_default).encode("utf-8")
        if len(payload_bytes) > _MAX_PAYLOAD_SIZE:
            logger.error(
                "Notification payload too large: %d bytes (max: %d), dropping",
                len(payload_bytes),
                _MAX_PAYLOAD_SIZE,
            )
            return  # Drop oversized notifications to prevent pipe blocking
        _emit_stdout_line(payload_bytes)
    except Exception as exc:
        # If stdout is broken, log to stderr but DO NOT crash the backend.
        logger.error("Failed to write notification to stdout: %s", exc)


def _json_default(obj: Any) -> Any:
    if isinstance(obj, Path):
        return str(obj)
    # Defense-in-depth for handlers that forget to normalize openpyxl dates
    if isinstance(obj, datetime):
        if obj.time() == dt_time(0, 0):
            return obj.date().isoformat()
        return obj.isoformat(sep=" ", timespec="seconds")
    if isinstance(obj, date):
        return obj.isoformat()
    if isinstance(obj, dt_time):
        return obj.isoformat(timespec="seconds")
    msg = f"Object of type {type(obj).__name__} is not JSON serializable"
    raise TypeError(msg)


# Sentinel returned on parse errors (not EOF)
_SKIP = object()

_REQUEST_ID_RE = re.compile(r'"id"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|(-?\d+))')
# Variante bytes para el path oversized: el prefijo truncado puede cortar un
# carácter UTF-8 multibyte, así que el id se extrae de los bytes crudos en vez
# de depender de un decode que puede fallar.
_REQUEST_ID_RE_BYTES = re.compile(rb'"id"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|(-?\d+))')
_READ_CHUNK_SIZE = 64 * 1024
_REQUEST_ID_PREFIX_SIZE = 4096


def _try_extract_request_id(line: str) -> str | int | None:
    """Best-effort id extraction without parsing the full JSON payload."""
    match = _REQUEST_ID_RE.search(line)
    if not match:
        return None
    if match.group(1) is not None:
        return bytes(match.group(1), "utf-8").decode("unicode_escape")
    return int(match.group(2))


def _try_extract_request_id_bytes(prefix: bytes) -> str | int | None:
    """Best-effort id extraction from a truncated raw-bytes prefix."""
    match = _REQUEST_ID_RE_BYTES.search(prefix)
    if not match:
        return None
    if match.group(1) is not None:
        return match.group(1).decode("unicode_escape")
    return int(match.group(2))


def _piece_size(piece: str | bytes) -> int:
    if isinstance(piece, bytes):
        return len(piece)
    try:
        return len(piece.encode("utf-8"))
    except UnicodeEncodeError:
        return len(piece)


def _read_size() -> int:
    return max(1, min(_READ_CHUNK_SIZE, _MAX_PAYLOAD_SIZE + 1))


def _read_limited_line(stream: Any, *, binary: bool) -> tuple[str | bytes | None, int, bool]:
    parts: list[str | bytes] = []
    prefix: str | bytes = b"" if binary else ""
    total = 0

    while True:
        read_size = max(1, min(_read_size(), _MAX_PAYLOAD_SIZE - total + 1))
        piece = stream.readline(read_size)
        if not piece:
            if total == 0:
                return None, 0, False
            return _join_parts(parts), total, False
        if binary != isinstance(piece, bytes):
            raise TypeError("stdin returned mixed text and binary chunks")

        piece_size = _piece_size(piece)
        total += piece_size
        if len(prefix) < _REQUEST_ID_PREFIX_SIZE:
            prefix += piece[:_REQUEST_ID_PREFIX_SIZE - len(prefix)]

        newline = b"\n" if binary else "\n"
        if total > _MAX_PAYLOAD_SIZE:
            if newline not in piece:
                total += _drain_line(stream, binary)
            return prefix, total, True

        parts.append(piece)
        if newline in piece:
            return _join_parts(parts), total, False


def _join_parts(parts: list[str | bytes]) -> str | bytes:
    if not parts:
        return ""
    if isinstance(parts[0], bytes):
        return b"".join(parts)  # type: ignore[arg-type]
    return "".join(parts)  # type: ignore[arg-type]


def _drain_line(stream: Any, binary: bool) -> int:
    newline = b"\n" if binary else "\n"
    total = 0
    while True:
        piece = stream.readline(_read_size())
        total += _piece_size(piece)
        if not piece or newline in piece:
            return total


def read_message() -> IPCMessage | None:
    """Lee una línea JSON desde stdin. Returns None on EOF, _SKIP on parse error.

    Parse errors are logged to stderr (no response is sent) because the
    request id is unknown and an `id=None` response cannot be correlated
    by the IPC router on the renderer side — it would just be discarded
    and the caller would block until its own timeout.
    """
    try:
        stdin = getattr(sys.stdin, "buffer", None)
        binary = stdin is not None
        if not binary:
            stdin = sys.stdin
        line, line_bytes, oversized = _read_limited_line(stdin, binary=binary)
        if line is None:
            return None
        # Parse window starts only after the line is fully read (excludes stdin idle).
        parse_start = ipc_phase_telemetry.begin_parse()
        if oversized:
            # El prefijo truncado puede cortar un carácter UTF-8 multibyte: el
            # id se extrae de los bytes crudos (viaja al inicio del JSON) para
            # que la respuesta -32600 sí se envíe. Antes, el decode estricto
            # lanzaba UnicodeDecodeError, caía en el except genérico y el
            # caller esperaba hasta su timeout sin respuesta alguna.
            msg_id = (
                _try_extract_request_id_bytes(line)
                if isinstance(line, bytes)
                else _try_extract_request_id(line)
            )
            logger.error(
                "Inbound IPC payload too large: %d bytes (max: %d)",
                line_bytes,
                _MAX_PAYLOAD_SIZE,
            )
            if msg_id is not None:
                ipc_phase_telemetry.finish_parse(msg_id, parse_start)
                send_response(
                    None,
                    msg_id,
                    error=f"Request payload too large ({line_bytes} bytes)",
                    error_code=-32600,
                    error_category="INVALID_REQUEST",
                )
            return _SKIP  # type: ignore[return-value]
        if isinstance(line, bytes):
            line = line.decode("utf-8")
        data = json.loads(line)
        msg_id = data.get("id") if isinstance(data, dict) else None
        try:
            msg = IPCMessage(data)
            ipc_phase_telemetry.finish_parse(msg.id, parse_start, method=msg.method)
            return msg
        except (ValueError, AntaresBaseException) as exc:
            if msg_id is not None:
                ipc_phase_telemetry.finish_parse(msg_id, parse_start)
                send_response(None, msg_id, error=exc)
            else:
                logger.error("Invalid IPC message with no id: %s", exc)
            return _SKIP  # type: ignore[return-value]
    except json.JSONDecodeError as exc:
        logger.error("JSON inválido en stdin: %s", exc)
        return _SKIP  # type: ignore[return-value]
    except Exception:
        logger.error("Error leyendo stdin: %s", traceback.format_exc())
        return _SKIP  # type: ignore[return-value]
