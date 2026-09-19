
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field

from backend.core.observability import log_event


@dataclass
class ProcessState:
    running: bool = False
    progress: int = 0
    total: int = 0
    current_file: str = ""
    ok_count: int = 0
    err_count: int = 0
    logs: list[dict[str, str]] = field(default_factory=list)
    cancel_requested: bool = False
    _lock: threading.RLock = field(default_factory=threading.RLock)


# Estado del proceso de conversión en curso; lo leen los handlers de
# status/cancel y lo escribe el runner de conversion_job.
process_state = ProcessState()


def reset_state(state: ProcessState | None = None) -> None:
    target = state or process_state
    with target._lock:
        target.running = False
        target.progress = 0
        target.total = 0
        target.current_file = ""
        target.ok_count = 0
        target.err_count = 0
        target.logs = []
        target.cancel_requested = False


_LOGGER = logging.getLogger("backend.handlers.conversion")
_TAG_LEVEL_MAP: dict[str, int] = {
    "error": logging.ERROR,
    "warn": logging.WARNING,
    "ok": logging.INFO,
    "info": logging.INFO,
}
_TAG_OUTCOME_MAP: dict[str, str] = {
    "error": "failed",
    "ok": "success",
}


def log_message(msg: str, tag: str = "info", state: ProcessState | None = None) -> None:
    target = state or process_state
    with target._lock:
        target.logs.insert(0, {"message": msg, "tag": tag})
        if len(target.logs) > 100:
            del target.logs[100:]
    tag_clean = tag.strip().lower()
    level = _TAG_LEVEL_MAP.get(tag_clean, logging.INFO)
    outcome = _TAG_OUTCOME_MAP.get(tag_clean)
    if outcome is not None:
        log_event(_LOGGER, level, "conversion.batch.item", message=msg, outcome=outcome)
    else:
        log_event(_LOGGER, level, "conversion.batch.item", message=msg)
