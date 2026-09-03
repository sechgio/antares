
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

def _parse_max_payload_size() -> int:
    raw = os.environ.get("ANTARES_IPC_MAX_PAYLOAD_SIZE", "")
    if not raw:
        return 64 * 1024 * 1024
    s = raw.strip().lower()
    try:
        if s.endswith("mb"):
            value = int(s[:-2].strip()) * 1024 * 1024
        elif s.endswith("kb"):
            value = int(s[:-2].strip()) * 1024
        elif s.endswith("b"):
            value = int(s[:-1].strip())
        else:
            value = int(s)
    except ValueError:
        logger.warning("ANTARES_IPC_MAX_PAYLOAD_SIZE inválido %r, usando 64MB por defecto", raw)
        return 64 * 1024 * 1024
    if value <= 0 or value > 256 * 1024 * 1024:
        logger.warning("ANTARES_IPC_MAX_PAYLOAD_SIZE fuera de rango %r, usando 64MB por defecto", raw)
        return 64 * 1024 * 1024
    return value


_MAX_PAYLOAD_SIZE = _parse_max_payload_size()


def validate_method(method: str) -> bool:
    if not method or not isinstance(method, str):
        return False
    return bool(re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", method))


def validate_params(params: dict) -> bool:
    if not isinstance(params, dict):
        return False
    return not any(path_param_violations(params, strict=True))


class IPCMessage:

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
        payload_bytes = json.dumps(payload, ensure_ascii=False, default=_json_default).encode("utf-8")
        if len(payload_bytes) > _MAX_PAYLOAD_SIZE:
            logger.error(
                "Response payload too large: %d bytes (max: %d)",
                len(payload_bytes),
                _MAX_PAYLOAD_SIZE,
            )
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
            return
        _emit_stdout_line(payload_bytes)
    except Exception as exc:
        logger.error("Failed to write notification to stdout: %s", exc)


def _json_default(obj: Any) -> Any:
    if isinstance(obj, Path):
        return str(obj)
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


_SKIP = object()

_REQUEST_ID_RE = re.compile(r'"id"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|(-?\d+))')
_REQUEST_ID_RE_BYTES = re.compile(rb'"id"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|(-?\d+))')
_READ_CHUNK_SIZE = 64 * 1024
_REQUEST_ID_PREFIX_SIZE = 4096


def _try_extract_request_id(line: str) -> str | int | None:
    match = _REQUEST_ID_RE.search(line)
    if not match:
        return None
    if match.group(1) is not None:
        return bytes(match.group(1), "utf-8").decode("unicode_escape")
    return int(match.group(2))


def _try_extract_request_id_bytes(prefix: bytes) -> str | int | None:
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
    try:
        stdin = getattr(sys.stdin, "buffer", None)
        binary = stdin is not None
        if not binary:
            stdin = sys.stdin
        line, line_bytes, oversized = _read_limited_line(stdin, binary=binary)
        if line is None:
            return None
        parse_start = ipc_phase_telemetry.begin_parse()
        if oversized:
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
