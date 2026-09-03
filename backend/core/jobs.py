
from __future__ import annotations

import logging
import os
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from backend.core.canvas.models import utc_now_iso as _utc_now
from backend.core.observability import get_context, log_event, request_context
from backend.core.state import ProcessState

logger = logging.getLogger(__name__)


DEFAULT_JOB_ID = "default"


def resolve_job_id(params: dict[str, Any], *, default: str = DEFAULT_JOB_ID) -> str:
    val = params.get("job_id", default)
    return str(val) if val is not None else default


def is_legacy_default_job(job_id: str) -> bool:
    return job_id == DEFAULT_JOB_ID


def _detect_max_concurrent() -> int:
    try:
        cpu_count = os.cpu_count() or 2
        try:
            import psutil
            available_gb = psutil.virtual_memory().available / (1024 ** 3)
        except ImportError:
            available_gb = 4
        ram_limited = max(1, int(available_gb // 2))
        return max(4, min(cpu_count, ram_limited, 16))
    except Exception:
        return 4


MAX_CONCURRENT_DEFAULT = _detect_max_concurrent()
MAX_COMPLETED_JOBS = 15


@dataclass
class Job:

    id: str
    job_type: str
    state: ProcessState = field(default_factory=ProcessState)
    thread: threading.Thread | None = None
    created_at: str = field(default_factory=_utc_now)
    started_at: str | None = None
    finished_at: str | None = None
    duration_ms: int | None = None
    request_id: str | None = None
    params: dict[str, Any] = field(default_factory=dict)
    result: dict[str, Any] | None = None

    def _snapshot_locked(self) -> dict[str, Any]:
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
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "duration_ms": self.duration_ms,
        }

    def to_dict(self) -> dict[str, Any]:
        with self.state._lock:
            return self._snapshot_locked()

    def to_dict_detail(self) -> dict[str, Any]:
        with self.state._lock:
            result = dict(self.result) if isinstance(self.result, dict) else self.result
            return {
                **self._snapshot_locked(),
                "logs": [dict(log) for log in self.state.logs],
                "params": self.params,
                "result": result,
            }


class JobManager:

    def __init__(self, max_concurrent: int = MAX_CONCURRENT_DEFAULT) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.RLock()
        self.max_concurrent = max_concurrent
        self._out_path_lock = threading.Lock()
        self._reserved_out_paths: dict[str, str] = {}

    def try_reserve_out_path(self, job_id: str, path_key: str) -> bool:
        with self._out_path_lock:
            owner = self._reserved_out_paths.get(path_key)
            if owner is not None and owner != job_id:
                return False
            self._reserved_out_paths[path_key] = job_id
            return True

    def get_out_path_owner(self, path_key: str) -> str | None:
        with self._out_path_lock:
            return self._reserved_out_paths.get(path_key)

    def release_out_paths(self, job_id: str) -> None:
        with self._out_path_lock:
            stale = [k for k, owner in self._reserved_out_paths.items() if owner == job_id]
            for key in stale:
                del self._reserved_out_paths[key]

    def create_job(
        self,
        job_type: str,
        params: dict[str, Any],
        target: Callable[..., Any],
        job_id: str | None = None,
        daemon: bool = True,
    ) -> dict[str, Any]:
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

            if job_id in self._jobs:
                del self._jobs[job_id]

            job = Job(id=job_id, job_type=job_type, request_id=get_context().get("request_id"), params=params)
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
                started_clock = time.perf_counter()
                with request_context(
                    request_id=j.request_id,
                    job_id=j.id,
                    method=j.job_type,
                    lane="job",
                ):
                    j.started_at = _utc_now()
                    log_event(
                        logger,
                        logging.INFO,
                        "job.started",
                        job_id=j.id,
                        method=j.job_type,
                    )
                    try:
                        t(j)
                    except Exception as exc:
                        logger.exception("Job %s crashed: %s", j.id, exc)
                        log_event(
                            logger,
                            logging.ERROR,
                            "job.failed",
                            message=f"{type(exc).__name__}: {exc}",
                            job_id=j.id,
                            method=j.job_type,
                            outcome="failed",
                        )
                        with j.state._lock:
                            j.state.err_count = max(j.state.err_count, 1)
                            j.state.logs.insert(0, {
                                "message": f"Error interno: {type(exc).__name__}: {exc}",
                                "tag": "error",
                            })
                            if len(j.state.logs) > 100:
                                del j.state.logs[100:]
                            j.result = {
                                "ok_count": j.state.ok_count,
                                "err_count": j.state.err_count,
                                "cancelled": False,
                                "error": f"{type(exc).__name__}: {exc}",
                            }
                    finally:
                        finished_clock = time.perf_counter()
                        with j.state._lock:
                            j.state.running = False
                            cancelled = j.state.cancel_requested or bool(
                                isinstance(j.result, dict) and j.result.get("cancelled")
                            )
                            ok_count = j.state.ok_count
                            err_count = j.state.err_count
                        j.finished_at = _utc_now()
                        j.duration_ms = max(0, round((finished_clock - started_clock) * 1000))
                        outcome = (
                            "cancelled"
                            if cancelled
                            else "failed"
                            if err_count > 0 and ok_count == 0
                            else "partial"
                            if err_count > 0
                            else "success"
                        )
                        log_event(
                            logger,
                            logging.INFO if outcome in {"success", "partial", "cancelled"} else logging.ERROR,
                            "job.finished",
                            job_id=j.id,
                            method=j.job_type,
                            outcome=outcome,
                            duration_ms=j.duration_ms,
                        )
                        self.release_out_paths(j.id)
                        self._slim_completed_job(j)

            job.thread = threading.Thread(
                target=_wrapped_target,
                daemon=daemon,
                name=f"job-{job_id}",
            )
            self._jobs[job_id] = job
            job.thread.start()

        self.cleanup_completed()
        return {"started": True, "job_id": job_id}

    def get_job(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list_jobs(self, job_type: str | None = None) -> list[Job]:
        with self._lock:
            jobs = list(self._jobs.values())
        if job_type:
            jobs = [j for j in jobs if j.job_type == job_type]
        return jobs

    def cancel_job(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            return {"cancelled": False, "reason": "job_not_found"}
        with job.state._lock:
            if not job.state.running:
                return {"cancelled": False, "reason": "job_not_running"}
            job.state.cancel_requested = True
        return {"cancelled": True, "job_id": job_id}

    @staticmethod
    def _slim_completed_job(job: Job) -> None:
        params = job.params
        if not isinstance(params, dict):
            return
        files = params.get("files")
        if isinstance(files, list) and files:
            file_count = len(files)
        else:
            stored = params.get("file_count")
            file_count = stored if isinstance(stored, int) else 0
        job.params = {
            "file_count": file_count,
            "destino": params.get("destino"),
            "formato": params.get("formato"),
            "files": [],
        }

    def cleanup_completed(self, max_remaining: int = MAX_COMPLETED_JOBS) -> int:
        with self._lock:
            completed = [
                (jid, j) for jid, j in self._jobs.items()
                if not j.state.running and jid != DEFAULT_JOB_ID
            ]
            if len(completed) <= max_remaining:
                return 0
            completed.sort(key=lambda x: x[1].created_at)
            to_remove = completed[: len(completed) - max_remaining]
            for jid, _ in to_remove:
                del self._jobs[jid]
            return len(to_remove)

    def get_default_job(self) -> Job | None:
        return self.get_job(DEFAULT_JOB_ID)


_job_manager: JobManager | None = None
_job_manager_lock = threading.Lock()


def get_job_manager() -> JobManager:
    global _job_manager
    if _job_manager is None:
        with _job_manager_lock:
            if _job_manager is None:
                _job_manager = JobManager()
    return _job_manager
