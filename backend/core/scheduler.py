"""Global execution scheduler for light and heavy backend work."""

from __future__ import annotations

import logging
import os
import threading
import time
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any

logger = logging.getLogger(__name__)


class SchedulerBusy(RuntimeError):
    """Raised when the heavy work budget is already fully reserved."""


def _detect_limits() -> tuple[int, int, int]:
    """Return conservative `(light_workers, heavy_workers, heavy_queue_limit)`."""
    cpu_count = os.cpu_count() or 2
    try:
        import psutil

        available_gb = psutil.virtual_memory().available / (1024 ** 3)
    except ImportError:
        available_gb = 4

    light_workers = max(2, min(cpu_count, 4))
    ram_limited_heavy = max(1, int(available_gb // 2))
    heavy_workers = max(2, min(max(1, cpu_count // 2), ram_limited_heavy, 8))
    heavy_queue_limit = max(heavy_workers, heavy_workers * 2)
    return light_workers, heavy_workers, heavy_queue_limit


class WorkScheduler:
    """Coordinate light IPC work and resource-heavy backend tasks."""

    def __init__(
        self,
        *,
        light_workers: int,
        heavy_workers: int,
        heavy_queue_limit: int,
    ) -> None:
        self.light_workers = max(1, light_workers)
        self.heavy_workers = max(1, heavy_workers)
        self.heavy_queue_limit = max(0, heavy_queue_limit)
        
        # Unified pool size: enough for all light tasks + heavy concurrency limit.
        # We don't want heavy tasks to be able to occupy more than self.heavy_workers 
        # threads at once, but we want a shared pool for efficiency.
        self._max_total_workers = self.light_workers + self.heavy_workers
        self._executor = ThreadPoolExecutor(
            max_workers=self._max_total_workers,
            thread_name_prefix="handler-pool",
        )
        
        self.heavy_capacity = self.heavy_workers + self.heavy_queue_limit
        self._heavy_slots = threading.BoundedSemaphore(self.heavy_capacity)
        self._lock = threading.RLock()
        self._heavy_outstanding = 0
        self._heavy_active = 0
        self._heavy_rejected = 0
        self._heavy_cancelled_waits = 0
        self._heavy_submitted = 0
        self._heavy_completed = 0

    @classmethod
    def autodetected(cls) -> WorkScheduler:
        light_workers, heavy_workers, heavy_queue_limit = _detect_limits()
        return cls(
            light_workers=light_workers,
            heavy_workers=heavy_workers,
            heavy_queue_limit=heavy_queue_limit,
        )

    def submit_light(self, fn: Callable[..., Any], /, *args: Any, **kwargs: Any) -> Future:
        """Submit latency-sensitive work that should not wait behind heavy jobs."""
        return self._executor.submit(fn, *args, **kwargs)

    def submit_heavy(
        self,
        fn: Callable[..., Any],
        /,
        *args: Any,
        block: bool = False,
        cancel_check: Callable[[], bool] | None = None,
        **kwargs: Any,
    ) -> Future | None:
        """Submit heavy work within a bounded global budget.

        `block=False` reserves capacity immediately or raises `SchedulerBusy`.
        `block=True` waits for capacity, but returns `None` if `cancel_check`
        becomes true before a slot opens.
        """
        acquired = self._acquire_heavy_slot(block=block, cancel_check=cancel_check)
        if not acquired:
            return None

        with self._lock:
            self._heavy_outstanding += 1
            self._heavy_submitted += 1

        def _wrapped() -> Any:
            with self._lock:
                self._heavy_active += 1
            try:
                return fn(*args, **kwargs)
            finally:
                with self._lock:
                    self._heavy_active -= 1
                    self._heavy_outstanding -= 1
                    self._heavy_completed += 1
                self._heavy_slots.release()

        return self._executor.submit(_wrapped)

    def _acquire_heavy_slot(
        self,
        *,
        block: bool,
        cancel_check: Callable[[], bool] | None,
    ) -> bool:
        if not block:
            if self._heavy_slots.acquire(blocking=False):
                return True
            with self._lock:
                self._heavy_rejected += 1
            raise SchedulerBusy("heavy_queue_full")

        while True:
            if cancel_check and cancel_check():
                with self._lock:
                    self._heavy_cancelled_waits += 1
                return False
            if self._heavy_slots.acquire(timeout=0.05):
                return True
            time.sleep(0)

    def metrics(self) -> dict[str, Any]:
        """Return internal queue/worker metrics for diagnostics."""
        with self._lock:
            queued = max(0, self._heavy_outstanding - self._heavy_active)
            m = {
                "light_workers": self.light_workers,
                "heavy_workers": self.heavy_workers,
                "heavy_queue_limit": self.heavy_queue_limit,
                "heavy_capacity": self.heavy_capacity,
                "heavy_outstanding": self._heavy_outstanding,
                "heavy_active": self._heavy_active,
                "heavy_queued": queued,
                "heavy_rejected": self._heavy_rejected,
                "heavy_cancelled_waits": self._heavy_cancelled_waits,
                "heavy_submitted": self._heavy_submitted,
                "heavy_completed": self._heavy_completed,
            }
            try:
                import psutil
                vm = psutil.virtual_memory()
                m["system_ram_total_mb"] = int(vm.total / (1024 * 1024))
                m["system_ram_available_mb"] = int(vm.available / (1024 * 1024))
                m["system_ram_percent"] = vm.percent
            except ImportError:
                pass
            return m

    def shutdown(self, *, wait: bool = True) -> None:
        """Shut down the unified executor."""
        self._executor.shutdown(wait=wait, cancel_futures=True)


_scheduler: WorkScheduler | None = None
_scheduler_lock = threading.Lock()


def get_scheduler() -> WorkScheduler:
    """Return the process-wide scheduler singleton."""
    global _scheduler
    if _scheduler is None:
        with _scheduler_lock:
            if _scheduler is None:
                _scheduler = WorkScheduler.autodetected()
                logger.info("Scheduler initialized: %s", _scheduler.metrics())
    return _scheduler
