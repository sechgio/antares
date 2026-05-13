"""Process state data structure for tracking job progress.

This module is in core/ (not handlers/) to avoid circular imports:
core/jobs.py needs ProcessState, and handlers/ needs core/jobs.py.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field


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
    _lock: threading.Lock = field(default_factory=threading.Lock)
