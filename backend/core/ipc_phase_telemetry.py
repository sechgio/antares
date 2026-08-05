"""Opt-in IPC phase telemetry: latency + RSS correlated by msg_id.

Enabled when ``ANTARES_IPC_TELEMETRY`` is truthy (1/true/yes). When disabled,
public helpers are cheap no-ops so the hot path pays only an env check.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)

_LOCK = threading.Lock()
_TRACES: dict[str, RequestTrace] = {}
_PROCESS: Any | None = None
_PROCESS_FAILED = False

_MARK_ORDER = (
    "line_ready",
    "parse",
    "enqueue",
    "dispatch_start",
    "handler_end",
    "serialize_write_end",
)


def enabled() -> bool:
    raw = os.environ.get("ANTARES_IPC_TELEMETRY", "").strip().lower()
    return raw in {"1", "true", "yes"}


def reset_for_tests() -> None:
    """Clear in-flight traces (test helper)."""
    global _PROCESS, _PROCESS_FAILED
    with _LOCK:
        _TRACES.clear()
    _PROCESS = None
    _PROCESS_FAILED = False


def trace_count() -> int:
    with _LOCK:
        return len(_TRACES)


def _key(msg_id: str | int) -> str:
    return str(msg_id)


def _rss_bytes() -> int | None:
    """Return current process RSS in bytes, or None if unavailable."""
    global _PROCESS, _PROCESS_FAILED
    if _PROCESS_FAILED:
        return None
    try:
        if _PROCESS is None:
            import psutil

            _PROCESS = psutil.Process()
        return int(_PROCESS.memory_info().rss)
    except Exception:
        _PROCESS_FAILED = True
        return None


def _mib(value: int | None) -> float | None:
    if value is None:
        return None
    return value / (1024.0 * 1024.0)


class RequestTrace:
    __slots__ = (
        "durations_ms",
        "handler_ok",
        "lane",
        "marks",
        "method",
        "msg_id",
        "ok",
        "rejected",
        "write_ok",
    )

    def __init__(self, msg_id: str | int) -> None:
        self.msg_id = msg_id
        self.method = ""
        self.lane = ""
        self.marks: dict[str, tuple[float, int | None]] = {}
        self.durations_ms: dict[str, float] = {}
        self.handler_ok: bool | None = None
        self.write_ok: bool | None = None
        self.ok: bool | None = None
        self.rejected: str | None = None

    def mark(self, name: str) -> None:
        try:
            rss = _rss_bytes()
        except Exception:
            rss = None
        self.marks[name] = (time.perf_counter(), rss)


def start(
    msg_id: str | int,
    *,
    method: str = "",
    lane: str = "",
    mark_line_ready: bool = True,
) -> None:
    if not enabled():
        return
    try:
        key = _key(msg_id)
        with _LOCK:
            trace = _TRACES.get(key)
            if trace is None:
                trace = RequestTrace(msg_id)
                _TRACES[key] = trace
            if method:
                trace.method = method
            if lane:
                trace.lane = lane
            if mark_line_ready and "line_ready" not in trace.marks:
                trace.mark("line_ready")
    except Exception:
        logger.debug("ipc_phase start failed", exc_info=True)


def mark(msg_id: str | int, name: str) -> None:
    if not enabled():
        return
    try:
        key = _key(msg_id)
        with _LOCK:
            trace = _TRACES.get(key)
            if trace is None:
                return
            trace.mark(name)
    except Exception:
        logger.debug("ipc_phase mark failed", exc_info=True)


def begin_parse() -> tuple[float, int | None] | None:
    """Capture parse start immediately after stdin line bytes are available."""
    if not enabled():
        return None
    try:
        try:
            rss = _rss_bytes()
        except Exception:
            rss = None
        return time.perf_counter(), rss
    except Exception:
        return None


def finish_parse(
    msg_id: str | int | None,
    parse_start: tuple[float, int | None] | None,
    *,
    method: str = "",
) -> None:
    """Close the parse window and attach it to the request trace."""
    if not enabled() or msg_id is None or parse_start is None:
        return
    try:
        start_t, start_rss = parse_start
        elapsed_ms = (time.perf_counter() - start_t) * 1000.0
        key = _key(msg_id)
        with _LOCK:
            trace = _TRACES.get(key)
            if trace is None:
                trace = RequestTrace(msg_id)
                _TRACES[key] = trace
            if method:
                trace.method = method
            trace.marks["line_ready"] = (start_t, start_rss)
            trace.mark("parse")
            trace.durations_ms["parse_ms"] = elapsed_ms
    except Exception:
        logger.debug("ipc_phase finish_parse failed", exc_info=True)


def set_fields(msg_id: str | int, **fields: Any) -> None:
    if not enabled():
        return
    key = _key(msg_id)
    with _LOCK:
        trace = _TRACES.get(key)
        if trace is None:
            return
        for name, value in fields.items():
            if name == "method" and isinstance(value, str):
                trace.method = value
            elif name == "lane" and isinstance(value, str):
                trace.lane = value
            elif name == "handler_ok" and isinstance(value, bool):
                trace.handler_ok = value
            elif name == "write_ok" and isinstance(value, bool):
                trace.write_ok = value
            elif name == "ok" and isinstance(value, bool):
                trace.ok = value
            elif name == "rejected" and isinstance(value, str):
                trace.rejected = value
            elif name.endswith("_ms") and isinstance(value, (int, float)):
                trace.durations_ms[name] = float(value)


def _compute_derived(trace: RequestTrace) -> None:
    marks = trace.marks
    if "enqueue" in marks and "dispatch_start" in marks:
        wait_ms = (marks["dispatch_start"][0] - marks["enqueue"][0]) * 1000.0
        trace.durations_ms["scheduler_wait_ms"] = max(0.0, wait_ms)
    elif "dispatch_start" in marks and "enqueue" not in marks:
        # Sync path: dispatch runs inline with no queue wait.
        trace.durations_ms.setdefault("scheduler_wait_ms", 0.0)

    if "dispatch_start" in marks and "handler_end" in marks:
        trace.durations_ms.setdefault(
            "handler_ms",
            max(0.0, (marks["handler_end"][0] - marks["dispatch_start"][0]) * 1000.0),
        )


def _format_line(trace: RequestTrace) -> str:
    _compute_derived(trace)
    parts = [
        "ipc_phase",
        f"msg_id={trace.msg_id}",
        f"method={trace.method or '-'}",
        f"lane={trace.lane or '-'}",
    ]
    if trace.rejected:
        parts.append(f"rejected={trace.rejected}")
    if trace.ok is not None:
        parts.append(f"ok={trace.ok}")
    if trace.handler_ok is not None:
        parts.append(f"handler_ok={trace.handler_ok}")
    if trace.write_ok is not None:
        parts.append(f"write_ok={trace.write_ok}")

    for key in ("parse_ms", "scheduler_wait_ms", "handler_ms", "serialize_write_ms"):
        if key == "handler_ms" and trace.rejected:
            continue
        if key in trace.durations_ms:
            parts.append(f"{key}={trace.durations_ms[key]:.1f}")

    # RSS snapshots and consecutive deltas following mark order.
    ordered = [name for name in _MARK_ORDER if name in trace.marks]
    rss_parts: list[str] = []
    prev_rss: int | None = None
    for name in ordered:
        _t, rss = trace.marks[name]
        mib = _mib(rss)
        if mib is not None:
            rss_parts.append(f"rss_{name}_miB={mib:.1f}")
        if rss is not None and prev_rss is not None:
            rss_parts.append(f"drss_{name}_miB={_mib(rss - prev_rss):.2f}")
        if rss is not None:
            prev_rss = rss
    if rss_parts:
        parts.append("rss_miB=" + ",".join(
            f"{_mib(trace.marks[n][1]):.1f}" for n in ordered if trace.marks[n][1] is not None
        ))
        parts.extend(rss_parts)
        # Compact consecutive delta summary for log grepping.
        deltas = [p for p in rss_parts if p.startswith("drss_")]
        if deltas:
            parts.append("drss_miB=" + ",".join(d.split("=", 1)[1] for d in deltas))

    return " ".join(parts)


def emit_and_clear(msg_id: str | int) -> None:
    if not enabled():
        return
    key = _key(msg_id)
    with _LOCK:
        trace = _TRACES.pop(key, None)
    if trace is None:
        return
    try:
        line = _format_line(trace)
        level = logging.WARNING if trace.rejected or trace.ok is False else logging.INFO
        logger.log(level, "%s", line)
    except Exception:
        logger.debug("ipc_phase emit failed", exc_info=True)
