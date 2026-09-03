from __future__ import annotations

import os
import shutil
import tempfile
from datetime import datetime, timezone
from typing import Any

from backend.core.scheduler import get_scheduler


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _process_snapshot() -> dict[str, Any]:
    snapshot: dict[str, Any] = {
        "pid": os.getpid(),
        "rss_bytes": None,
        "cpu_percent": None,
        "thread_count": None,
    }
    try:
        import psutil

        process = psutil.Process()
        snapshot["rss_bytes"] = int(process.memory_info().rss)
        snapshot["cpu_percent"] = round(float(process.cpu_percent(interval=None)), 2)
        snapshot["thread_count"] = int(process.num_threads())
    except (ImportError, OSError, RuntimeError, ValueError):
        pass
    return snapshot


def _temporary_storage_snapshot() -> dict[str, Any]:
    snapshot: dict[str, Any] = {
        "free_bytes": None,
        "total_bytes": None,
        "used_percent": None,
    }
    try:
        usage = shutil.disk_usage(tempfile.gettempdir())
        snapshot["free_bytes"] = int(usage.free)
        snapshot["total_bytes"] = int(usage.total)
        if usage.total > 0:
            snapshot["used_percent"] = round((usage.total - usage.free) * 100 / usage.total, 2)
    except OSError:
        pass
    return snapshot


def diagnostics_snapshot(params: dict[str, Any]) -> dict[str, Any]:
    del params
    return {
        "component": "backend",
        "timestamp": _utc_now(),
        "scheduler": get_scheduler().metrics(),
        "process": _process_snapshot(),
        "temporary_storage": _temporary_storage_snapshot(),
    }


HANDLERS = {
    "diagnostics_snapshot": diagnostics_snapshot,
}
