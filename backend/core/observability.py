
from __future__ import annotations

import contextvars
import json
import logging
import os
import re
import sys
import uuid
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any

_BACKEND_VERSION: str | None = None
try:
    from backend.version import __version__ as _BACKEND_VERSION
except ImportError:  # pragma: no cover - direct module execution fallback
    _BACKEND_VERSION = None


_SAFE_TOKEN_RE = re.compile(r"[^a-zA-Z0-9_.:-]")
_LEVEL_NAMES = {"DEBUG", "INFO", "WARN", "ERROR", "FATAL"}
_OUTCOMES = {"success", "partial", "degraded", "failed", "timeout", "cancelled", "rejected"}
_EVENT_FIELDS = {
    "attempt",
    "backend_pid",
    "bytes",
    "duration_ms",
    "error_code",
    "job_id",
    "lane",
    "message",
    "method",
    "operation_id",
    "outcome",
    "pid",
    "provider",
    "reason",
    "request_id",
    "status_class",
    "stream",
    "view",
}
_TEXT_REDACTIONS = (
    (
        re.compile(r"(\b(?:authorization|proxy-authorization)\s*[:=]\s*bearer\s+)[^\s,;]+", re.IGNORECASE),
        r"\1[REDACTED]",
    ),
    (
        re.compile(
            r"(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret)\s*[:=]\s*)"
            r"[\"']?[^\s,;\"']+[\"']?",
            re.IGNORECASE,
        ),
        r"\1[REDACTED]",
    ),
    (re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"), "[REDACTED]"),
    (
        re.compile(r"(?:[A-Za-z]:\\|\\\\|/(?:Users|home|tmp|var|private|opt|mnt|workspace)/)[^\s\"'`]+"),
        "[REDACTED]",
    ),
)

_REQUEST_CONTEXT: contextvars.ContextVar[dict[str, Any] | None] = contextvars.ContextVar(
    "antares_request_context",
    default=None,
)


def _safe_token(value: Any, max_length: int = 160) -> str | None:
    if value is None:
        return None
    safe = _SAFE_TOKEN_RE.sub("_", str(value)).strip("_")[:max_length]
    return safe or None


_SESSION_ID = _safe_token(os.environ.get("ANTARES_SESSION_ID")) or str(uuid.uuid4())
_APP_VERSION = _safe_token(os.environ.get("ANTARES_APP_VERSION"))


def redact_text(value: Any) -> str:
    safe = str(value)
    for pattern, replacement in _TEXT_REDACTIONS:
        safe = pattern.sub(replacement, safe)
    return re.sub(r"[\r\n]+", " ", safe)[:4000]


def get_context() -> dict[str, Any]:
    active = _REQUEST_CONTEXT.get() or {}
    return {
        "session_id": _SESSION_ID,
        "app_version": _APP_VERSION,
        "backend_version": _safe_token(_BACKEND_VERSION),
        "platform": sys.platform,
        "pid": os.getpid(),
        "request_id": active.get("request_id"),
        "method": active.get("method"),
        "lane": active.get("lane"),
        "job_id": active.get("job_id"),
        "operation_id": active.get("operation_id"),
    }


@contextmanager
def request_context(
    *,
    request_id: str | int | None = None,
    method: str | None = None,
    lane: str | None = None,
    job_id: str | None = None,
    operation_id: str | None = None,
) -> Iterator[None]:
    previous = _REQUEST_CONTEXT.get() or {}
    current = dict(previous)
    for key, value in {
        "request_id": request_id,
        "method": method,
        "lane": lane,
        "job_id": job_id,
        "operation_id": operation_id,
    }.items():
        if value is not None:
            current[key] = _safe_token(value)
    token = _REQUEST_CONTEXT.set(current)
    try:
        yield
    finally:
        _REQUEST_CONTEXT.reset(token)


def _level_name(level: int | str) -> str:
    if isinstance(level, int):
        level = logging.getLevelName(level)
    value = str(level).upper()
    if value == "WARNING":
        return "WARN"
    if value == "CRITICAL":
        return "FATAL"
    return value if value in _LEVEL_NAMES else "INFO"


def _safe_field(key: str, value: Any) -> tuple[bool, Any]:
    if key not in _EVENT_FIELDS:
        return False, None
    if key == "message":
        return True, redact_text(value)
    if key == "outcome":
        return (True, value) if value in _OUTCOMES else (False, None)
    if key in {"pid", "backend_pid", "bytes", "attempt"}:
        return (True, value) if isinstance(value, int) and value >= 0 else (False, None)
    if key == "duration_ms":
        return (
            (True, round(value))
            if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0
            else (False, None)
        )
    safe = _safe_token(value)
    return (True, safe) if safe is not None else (False, None)


def build_event(
    event: str,
    level: int | str,
    *,
    message: Any | None = None,
    fields: Mapping[str, Any] | None = None,
    **extra_fields: Any,
) -> dict[str, Any]:
    context = get_context()
    record: dict[str, Any] = {
        "schema_version": 1,
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "event": _safe_token(event) or "backend.log",
        "level": _level_name(level),
        "component": "backend",
        "app_version": context["app_version"],
        "backend_version": context["backend_version"],
        "platform": context["platform"],
        "pid": context["pid"],
        "session_id": context["session_id"],
    }
    for key in ("request_id", "method", "lane", "job_id", "operation_id"):
        value = context.get(key)
        if value is not None:
            record[key] = value
    if message is not None:
        record["message"] = redact_text(message)
    merged_fields = dict(fields or {})
    merged_fields.update(extra_fields)
    for key, value in merged_fields.items():
        included, safe_value = _safe_field(key, value)
        if included:
            record[key] = safe_value
    return record


class JsonLogFormatter(logging.Formatter):

    def format(self, record: logging.LogRecord) -> str:
        message = record.getMessage()
        if record.exc_info:
            traceback_text = self.formatException(record.exc_info)
            if traceback_text:
                message = f"{message}\n{traceback_text}"
        fields = dict(getattr(record, "observability_fields", {}))
        event = getattr(record, "observability_event", "backend.log")
        payload = build_event(event, record.levelno, message=message, fields=fields)
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def log_event(
    logger: logging.Logger,
    level: int,
    event: str,
    *,
    message: Any | None = None,
    **fields: Any,
) -> None:
    logger.log(
        level,
        "" if message is None else str(message),
        extra={"observability_event": event, "observability_fields": fields},
    )


def configure_logging(stream: Any = None) -> None:
    output = stream or sys.stderr
    root = logging.getLogger()
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=output)
    root.setLevel(logging.INFO)
    logging.getLogger("weasyprint").setLevel(logging.WARNING)
    logging.getLogger("fontTools").setLevel(logging.WARNING)
    if not root.handlers:
        root.addHandler(logging.StreamHandler(output))
    for h in root.handlers:
        if isinstance(h, logging.StreamHandler):
            h.setFormatter(JsonLogFormatter())
