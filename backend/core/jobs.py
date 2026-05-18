"""Job management for concurrent processing.

Provides a JobManager that tracks multiple independent processing jobs,
each with its own state and thread. Supports backward compatibility
with the existing single-job process_start/process_status/process_cancel
handlers.
"""

from __future__ import annotations

import logging
import os
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from backend.core.state import ProcessState

logger = logging.getLogger(__name__)

DEFAULT_JOB_ID = "default"


def _detect_max_concurrent() -> int:
    """Auto-detect max concurrent jobs based on CPU cores and RAM."""
    try:
        cpu_count = os.cpu_count() or 2
        # Try to get available RAM (Windows/Linux/macOS)
        try:
            import psutil
            available_gb = psutil.virtual_memory().available / (1024 ** 3)
        except ImportError:
            available_gb = 4  # fallback assumption
        # Each conversion job can use up to ~4 threads (image I/O + Pillow).
        # Cap at CPU count, but also respect RAM: ~2GB per job is generous.
        ram_limited = max(1, int(available_gb // 2))
        return max(4, min(cpu_count, ram_limited, 16))
    except Exception:
        return 4


MAX_CONCURRENT_DEFAULT = _detect_max_concurrent()
MAX_COMPLETED_JOBS = 50


@dataclass
class Job:
    """A single processing job with its own state and thread."""

    id: str
    job_type: str
    state: ProcessState = field(default_factory=ProcessState)
    thread: threading.Thread | None = None
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    params: dict[str, Any] = field(default_factory=dict)
    result: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        """Serialize job summary for IPC responses."""
        with self.state._lock:
            return {
                "id": self.id,
                "job_type": self.job_type,
                "running": self.state.running,
                "progress": self.state.progress,
                "total": self.state.total,
                "current_file": self.state.current_file,
                "ok_count": self.state.ok_count,
                "err_count": self.state.err_count,
                "cancel_requested": self.state.cancel_requested,
                "created_at": self.created_at,
            }

    def to_dict_detail(self) -> dict[str, Any]:
        """Serialize job detail (including logs) for IPC responses."""
        with self.state._lock:
            summary = {
                "id": self.id,
                "job_type": self.job_type,
                "running": self.state.running,
                "progress": self.state.progress,
                "total": self.state.total,
                "current_file": self.state.current_file,
                "ok_count": self.state.ok_count,
                "err_count": self.state.err_count,
                "cancel_requested": self.state.cancel_requested,
                "created_at": self.created_at,
                "logs": [dict(log) for log in self.state.logs],
                "params": self.params,
                "result": self.result,
            }
            return summary


class JobManager:
    """Manages concurrent processing jobs.

    Thread-safe. Each job gets its own ProcessState and thread.
    Supports a configurable max_concurrent limit.
    """

    def __init__(self, max_concurrent: int = MAX_CONCURRENT_DEFAULT) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.RLock()
        self.max_concurrent = max_concurrent

    def create_job(
        self,
        job_type: str,
        params: dict[str, Any],
        target: Callable[..., Any],
        job_id: str | None = None,
        daemon: bool = True,
    ) -> dict[str, Any]:
        """Create and start a new job.

        Args:
            job_type: Type of job (e.g. "conversion", "formato").
            params: Parameters passed to the target function.
            target: Callable to run in the job thread.
            job_id: Optional job ID. Defaults to auto-generated.
            daemon: Whether the job thread should be a daemon thread.

        Returns:
            Dict with "started" (bool), "job_id" (str), and optionally "reason".
        """
        with self._lock:
            running = sum(1 for j in self._jobs.values() if j.state.running)
            if running >= self.max_concurrent:
                return {
                    "started": False,
                    "reason": "max_concurrent_reached",
                    "running": running,
                    "max_concurrent": self.max_concurrent,
                }

            if job_id is None:
                job_id = f"{job_type}_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"

            if job_id in self._jobs and self._jobs[job_id].state.running:
                return {"started": False, "reason": "job_already_running", "job_id": job_id}

            # Clean up a completed job with the same ID before reusing
            if job_id in self._jobs:
                del self._jobs[job_id]

            job = Job(id=job_id, job_type=job_type, params=params)
            with job.state._lock:
                job.state.running = True
                job.state.total = 0
                job.state.progress = 0
                job.state.current_file = ""
                job.state.ok_count = 0
                job.state.err_count = 0
                job.state.logs = []
                job.state.cancel_requested = False

            def _wrapped_target(j: Job = job, t: Callable[..., Any] = target) -> None:
                """Ensure running=False is always set when the target finishes."""
                try:
                    t(j)
                finally:
                    with j.state._lock:
                        j.state.running = False

            job.thread = threading.Thread(
                target=_wrapped_target,
                daemon=daemon,
                name=f"job-{job_id}",
            )
            self._jobs[job_id] = job
            job.thread.start()

            return {"started": True, "job_id": job_id}

    def get_job(self, job_id: str) -> Job | None:
        """Get a job by ID."""
        with self._lock:
            return self._jobs.get(job_id)

    def list_jobs(self, job_type: str | None = None) -> list[Job]:
        """List all jobs, optionally filtered by type."""
        with self._lock:
            jobs = list(self._jobs.values())
        if job_type:
            jobs = [j for j in jobs if j.job_type == job_type]
        return jobs

    def cancel_job(self, job_id: str) -> dict[str, Any]:
        """Request cancellation of a job.

        Returns:
            Dict with "cancelled" (bool) and optionally "reason".
        """
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            return {"cancelled": False, "reason": "job_not_found"}
        with job.state._lock:
            if not job.state.running:
                return {"cancelled": False, "reason": "job_not_running"}
            job.state.cancel_requested = True
        return {"cancelled": True, "job_id": job_id}

    def cleanup_completed(self, max_remaining: int = MAX_COMPLETED_JOBS) -> int:
        """Remove old completed/failed jobs to free memory.

        Args:
            max_remaining: Keep at most this many completed jobs.

        Returns:
            Number of jobs removed.
        """
        with self._lock:
            completed = [
                (jid, j) for jid, j in self._jobs.items()
                if not j.state.running and jid != DEFAULT_JOB_ID
            ]
            if len(completed) <= max_remaining:
                return 0
            # Remove oldest completed jobs
            completed.sort(key=lambda x: x[1].created_at)
            to_remove = completed[: len(completed) - max_remaining]
            for jid, _ in to_remove:
                del self._jobs[jid]
            return len(to_remove)

    def get_default_job(self) -> Job | None:
        """Get the default job (backward compat)."""
        return self.get_job(DEFAULT_JOB_ID)


# Module-level singleton
_job_manager: JobManager | None = None
_job_manager_lock = threading.Lock()


def get_job_manager() -> JobManager:
    """Return the process-wide JobManager singleton."""
    global _job_manager
    if _job_manager is None:
        with _job_manager_lock:
            if _job_manager is None:
                _job_manager = JobManager()
    return _job_manager
