
from __future__ import annotations

import logging
import os
import threading
import time
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from backend.core.observability import log_event

logger = logging.getLogger(__name__)

MEMORY_PRESSURE_THRESHOLD_BYTES: int = 1 * 1024 * 1024 * 1024
MEMORY_PRESSURE_THRESHOLD_MB: int = MEMORY_PRESSURE_THRESHOLD_BYTES // (1024 * 1024)
MEMORY_PRESSURE_RETRY_AFTER_MS: int = 2000


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _milliseconds(seconds: float) -> float:
    return round(max(0.0, seconds * 1000.0), 3)


def _is_memory_pressure_disabled() -> bool:
    if os.environ.get("ANTARES_MEMORY_PRESSURE_DISABLE", "").strip().lower() in {"1", "true", "yes"}:
        return True
    if os.environ.get("ANTARES_MEMORY_PRESSURE_FORCE", "").strip().lower() in {"1", "true", "yes"}:
        return False
    return bool(os.environ.get("PYTEST_CURRENT_TEST"))


def _available_bytes() -> int | None:
    try:
        import psutil

        return int(psutil.virtual_memory().available)
    except ImportError:
        return None
    except Exception:
        return None


def is_memory_pressure(*, threshold_bytes: int = MEMORY_PRESSURE_THRESHOLD_BYTES) -> bool:
    if _is_memory_pressure_disabled():
        return False
    avail = _available_bytes()
    if avail is None:
        return False
    return avail < threshold_bytes


class SchedulerBusy(RuntimeError):

    def __init__(self, message: str = "heavy_queue_full", *, reason: str | None = None) -> None:
        super().__init__(message)
        self.reason = reason or message


def _light_queue_default(light_workers: int) -> int:
    return max(light_workers * 4, 16)


def _detect_limits() -> tuple[int, int, int, int]:
    cpu_count = os.cpu_count() or 2
    try:
        import psutil

        available_gb = psutil.virtual_memory().available / (1024 ** 3)
    except ImportError:
        available_gb = 4

    light_workers = max(2, min(cpu_count, 4))
    heavy_cap = 8 if available_gb >= 16 else 6
    ram_divisor = 2 if available_gb >= 16 else 3
    ram_limited_heavy = max(1, int(available_gb // ram_divisor))
    heavy_workers = max(2, min(max(1, cpu_count // 2), ram_limited_heavy, heavy_cap))
    heavy_queue_limit = max(heavy_workers, heavy_workers * 2)
    light_queue_limit = _light_queue_default(light_workers)
    if available_gb < 1.0:
        light_queue_limit = min(light_queue_limit, max(4, light_workers))
    elif available_gb < 2.0:
        light_queue_limit = min(light_queue_limit, max(8, light_workers * 2))
    return light_workers, heavy_workers, heavy_queue_limit, light_queue_limit


class WorkScheduler:

    def __init__(
        self,
        *,
        light_workers: int,
        heavy_workers: int,
        heavy_queue_limit: int,
        light_queue_limit: int | None = None,
    ) -> None:
        self.light_workers = max(1, light_workers)
        self.heavy_workers = max(1, heavy_workers)
        self.heavy_queue_limit = max(0, heavy_queue_limit)
        if light_queue_limit is None:
            light_queue_limit = _light_queue_default(self.light_workers)
        self.light_queue_limit = max(1, light_queue_limit)

        self._light_executor = ThreadPoolExecutor(
            max_workers=self.light_workers,
            thread_name_prefix="light-handler-pool",
        )
        self._heavy_executor = ThreadPoolExecutor(
            max_workers=self.heavy_workers,
            thread_name_prefix="heavy-handler-pool",
        )

        self.heavy_capacity = self.heavy_workers + self.heavy_queue_limit
        self._heavy_slots = threading.BoundedSemaphore(self.heavy_capacity)
        self.light_capacity = self.light_workers + self.light_queue_limit
        self._light_slots = threading.BoundedSemaphore(self.light_capacity)
        self._lock = threading.RLock()
        self._heavy_cond = threading.Condition(self._lock)
        self._reservation_sequence = 0
        self._light_waiting: dict[int, float] = {}
        self._heavy_waiting: dict[int, float] = {}
        self._light_active = 0
        self._heavy_outstanding = 0
        self._heavy_active = 0
        self._heavy_rejected = 0
        self._heavy_memory_pressure_rejected = 0
        self._heavy_cancelled_waits = 0
        self._heavy_cancelled = 0
        self._heavy_submitted = 0
        self._heavy_completed = 0
        self._heavy_worker_errors = 0
        self._light_outstanding = 0
        self._light_rejected = 0
        self._light_memory_pressure_rejected = 0
        self._light_cancelled = 0
        self._light_submitted = 0
        self._light_completed = 0
        self._light_worker_errors = 0
        self._light_queue_wait_count = 0
        self._light_queue_wait_total = 0.0
        self._light_queue_wait_last = 0.0
        self._light_queue_wait_max = 0.0
        self._heavy_queue_wait_count = 0
        self._heavy_queue_wait_total = 0.0
        self._heavy_queue_wait_last = 0.0
        self._heavy_queue_wait_max = 0.0
        self._light_run_count = 0
        self._light_run_total = 0.0
        self._light_run_last = 0.0
        self._light_run_max = 0.0
        self._heavy_run_count = 0
        self._heavy_run_total = 0.0
        self._heavy_run_last = 0.0
        self._heavy_run_max = 0.0

    @classmethod
    def autodetected(cls) -> WorkScheduler:
        light_workers, heavy_workers, heavy_queue_limit, light_queue_limit = _detect_limits()
        return cls(
            light_workers=light_workers,
            heavy_workers=heavy_workers,
            heavy_queue_limit=heavy_queue_limit,
            light_queue_limit=light_queue_limit,
        )

    def _reserve_waiting(self, waiting: dict[int, float]) -> int:
        self._reservation_sequence += 1
        token = self._reservation_sequence
        waiting[token] = time.perf_counter()
        return token

    def _record_queue_wait(self, lane: str, wait_ms: float) -> None:
        if lane == "light":
            self._light_queue_wait_count += 1
            self._light_queue_wait_total += wait_ms
            self._light_queue_wait_last = wait_ms
            self._light_queue_wait_max = max(self._light_queue_wait_max, wait_ms)
        else:
            self._heavy_queue_wait_count += 1
            self._heavy_queue_wait_total += wait_ms
            self._heavy_queue_wait_last = wait_ms
            self._heavy_queue_wait_max = max(self._heavy_queue_wait_max, wait_ms)

    def _record_run(self, lane: str, duration_ms: float) -> None:
        if lane == "light":
            self._light_run_count += 1
            self._light_run_total += duration_ms
            self._light_run_last = duration_ms
            self._light_run_max = max(self._light_run_max, duration_ms)
        else:
            self._heavy_run_count += 1
            self._heavy_run_total += duration_ms
            self._heavy_run_last = duration_ms
            self._heavy_run_max = max(self._heavy_run_max, duration_ms)

    def _record_worker_error(self, lane: str, error: Exception) -> None:
        with self._lock:
            if lane == "light":
                self._light_worker_errors += 1
            else:
                self._heavy_worker_errors += 1
        log_event(
            logger,
            logging.ERROR,
            "scheduler.worker_error",
            lane=lane,
            outcome="failed",
            reason="worker_error",
            error_code=type(error).__name__,
        )

    def _record_rejection(self, lane: str, reason: str, *, memory_pressure: bool = False) -> None:
        with self._lock:
            if lane == "light":
                self._light_rejected += 1
                if memory_pressure:
                    self._light_memory_pressure_rejected += 1
            else:
                self._heavy_rejected += 1
                if memory_pressure:
                    self._heavy_memory_pressure_rejected += 1
        log_event(
            logger,
            logging.WARNING,
            "scheduler.rejected",
            lane=lane,
            outcome="rejected",
            reason=reason,
        )

    def submit_light(self, fn: Callable[..., Any], /, *args: Any, **kwargs: Any) -> Future:
        if is_memory_pressure():
            effective_queue = min(self.light_queue_limit, max(4, self.light_workers))
            effective_capacity = self.light_workers + effective_queue
            with self._lock:
                if self._light_outstanding >= effective_capacity:
                    self._record_rejection("light", "memory_pressure", memory_pressure=True)
                    raise SchedulerBusy("light_queue_full", reason="memory_pressure")
        if not self._light_slots.acquire(blocking=False):
            self._record_rejection("light", "light_queue_full")
            raise SchedulerBusy("light_queue_full")
        with self._lock:
            self._light_outstanding += 1
            reservation = self._reserve_waiting(self._light_waiting)

        def _wrapped() -> Any:
            started_clock = time.perf_counter()
            with self._lock:
                queued_at = self._light_waiting.pop(reservation, started_clock)
                self._record_queue_wait("light", _milliseconds(started_clock - queued_at))
                self._light_active += 1
            try:
                return fn(*args, **kwargs)
            except Exception as exc:
                self._record_worker_error("light", exc)
                raise
            finally:
                duration_ms = _milliseconds(time.perf_counter() - started_clock)
                with self._lock:
                    self._light_active -= 1
                    self._light_outstanding -= 1
                    self._light_completed += 1
                    self._record_run("light", duration_ms)
                self._light_slots.release()

        try:
            future = self._light_executor.submit(_wrapped)
        except Exception:
            with self._lock:
                self._light_outstanding -= 1
                self._light_waiting.pop(reservation, None)
            self._light_slots.release()
            raise

        with self._lock:
            self._light_submitted += 1

        def _release_if_cancelled(fut: Future) -> None:
            if fut.cancelled():
                with self._lock:
                    if self._light_waiting.pop(reservation, None) is None:
                        return
                    self._light_outstanding -= 1
                    self._light_cancelled += 1
                self._light_slots.release()

        future.add_done_callback(_release_if_cancelled)
        return future

    def submit_heavy(
        self,
        fn: Callable[..., Any],
        /,
        *args: Any,
        block: bool = False,
        cancel_check: Callable[[], bool] | None = None,
        **kwargs: Any,
    ) -> Future | None:
        acquired = self._acquire_heavy_slot(block=block, cancel_check=cancel_check)
        if not acquired:
            log_event(
                logger,
                logging.INFO,
                "scheduler.cancelled",
                lane="heavy",
                outcome="cancelled",
                reason="cancelled_while_waiting",
            )
            return None

        with self._lock:
            self._heavy_outstanding += 1
            reservation = self._reserve_waiting(self._heavy_waiting)

        def _wrapped() -> Any:
            started_clock = time.perf_counter()
            with self._lock:
                queued_at = self._heavy_waiting.pop(reservation, started_clock)
                self._record_queue_wait("heavy", _milliseconds(started_clock - queued_at))
                self._heavy_active += 1
            try:
                return fn(*args, **kwargs)
            except Exception as exc:
                self._record_worker_error("heavy", exc)
                raise
            finally:
                duration_ms = _milliseconds(time.perf_counter() - started_clock)
                with self._lock:
                    self._heavy_active -= 1
                    self._heavy_outstanding -= 1
                    self._heavy_completed += 1
                    self._record_run("heavy", duration_ms)
                self._heavy_slots.release()
                self._notify_heavy()

        try:
            future = self._heavy_executor.submit(_wrapped)
        except Exception:
            with self._lock:
                self._heavy_outstanding -= 1
                self._heavy_waiting.pop(reservation, None)
            self._heavy_slots.release()
            self._notify_heavy()
            raise

        with self._lock:
            self._heavy_submitted += 1

        def _release_if_cancelled(fut: Future) -> None:
            if fut.cancelled():
                with self._lock:
                    if self._heavy_waiting.pop(reservation, None) is None:
                        return
                    self._heavy_outstanding -= 1
                    self._heavy_cancelled += 1
                self._heavy_slots.release()
                self._notify_heavy()

        future.add_done_callback(_release_if_cancelled)
        return future

    def _notify_heavy(self) -> None:
        with self._heavy_cond:
            self._heavy_cond.notify_all()

    def _acquire_heavy_slot(
        self,
        *,
        block: bool,
        cancel_check: Callable[[], bool] | None,
    ) -> bool:
        if not block:
            if self._heavy_slots.acquire(blocking=False):
                return True
            self._record_rejection("heavy", "heavy_queue_full")
            raise SchedulerBusy("heavy_queue_full")

        with self._heavy_cond:
            while True:
                if cancel_check and cancel_check():
                    with self._lock:
                        self._heavy_cancelled_waits += 1
                    return False
                if self._heavy_slots.acquire(blocking=False):
                    return True
                self._heavy_cond.wait(timeout=0.2)

    def metrics(self) -> dict[str, Any]:
        with self._lock:
            now = time.perf_counter()
            light_queue_age_ms = _milliseconds(
                max((now - queued_at for queued_at in self._light_waiting.values()), default=0.0)
            )
            heavy_queue_age_ms = _milliseconds(
                max((now - queued_at for queued_at in self._heavy_waiting.values()), default=0.0)
            )
            m: dict[str, Any] = {
                "snapshot_at": _utc_now(),
                "light_workers": self.light_workers,
                "light_queue_limit": self.light_queue_limit,
                "light_capacity": self.light_capacity,
                "light_outstanding": self._light_outstanding,
                "light_active": self._light_active,
                "light_queued": len(self._light_waiting),
                "light_queue_age_ms": light_queue_age_ms,
                "light_queue_wait_count": self._light_queue_wait_count,
                "light_queue_wait_total_ms": round(self._light_queue_wait_total, 3),
                "light_queue_wait_last_ms": self._light_queue_wait_last,
                "light_queue_wait_max_ms": self._light_queue_wait_max,
                "light_rejected": self._light_rejected,
                "light_memory_pressure_rejected": self._light_memory_pressure_rejected,
                "light_cancelled": self._light_cancelled,
                "light_submitted": self._light_submitted,
                "light_completed": self._light_completed,
                "light_worker_errors": self._light_worker_errors,
                "light_run_count": self._light_run_count,
                "light_run_total_ms": round(self._light_run_total, 3),
                "light_run_last_ms": self._light_run_last,
                "light_run_max_ms": self._light_run_max,
                "heavy_workers": self.heavy_workers,
                "heavy_queue_limit": self.heavy_queue_limit,
                "heavy_capacity": self.heavy_capacity,
                "heavy_outstanding": self._heavy_outstanding,
                "heavy_active": self._heavy_active,
                "heavy_run_slots": max(0, self.heavy_workers - self._heavy_active),
                "heavy_queued": len(self._heavy_waiting),
                "heavy_queue_age_ms": heavy_queue_age_ms,
                "heavy_queue_wait_count": self._heavy_queue_wait_count,
                "heavy_queue_wait_total_ms": round(self._heavy_queue_wait_total, 3),
                "heavy_queue_wait_last_ms": self._heavy_queue_wait_last,
                "heavy_queue_wait_max_ms": self._heavy_queue_wait_max,
                "heavy_rejected": self._heavy_rejected,
                "heavy_memory_pressure_rejected": self._heavy_memory_pressure_rejected,
                "heavy_cancelled_waits": self._heavy_cancelled_waits,
                "heavy_cancelled": self._heavy_cancelled,
                "heavy_submitted": self._heavy_submitted,
                "heavy_completed": self._heavy_completed,
                "heavy_worker_errors": self._heavy_worker_errors,
                "heavy_run_count": self._heavy_run_count,
                "heavy_run_total_ms": round(self._heavy_run_total, 3),
                "heavy_run_last_ms": self._heavy_run_last,
                "heavy_run_max_ms": self._heavy_run_max,
            }
            try:
                import psutil
                vm = psutil.virtual_memory()
                m["system_ram_total_mb"] = int(vm.total / (1024 * 1024))
                m["system_ram_available_mb"] = int(vm.available / (1024 * 1024))
                m["system_ram_percent"] = int(vm.percent)
            except ImportError:
                pass
            avail_mb = m.get("system_ram_available_mb")
            m["memory_pressure"] = bool(avail_mb is not None and avail_mb < MEMORY_PRESSURE_THRESHOLD_MB)
            m["memory_alert"] = (
                f"low_ram:{avail_mb}MB<{MEMORY_PRESSURE_THRESHOLD_MB}MB" if m["memory_pressure"] else None
            )
            return m

    def shutdown(self, *, wait: bool = True) -> None:
        self._light_executor.shutdown(wait=wait, cancel_futures=True)
        self._heavy_executor.shutdown(wait=wait, cancel_futures=True)


_scheduler: WorkScheduler | None = None
_scheduler_lock = threading.Lock()


def get_scheduler() -> WorkScheduler:
    global _scheduler
    if _scheduler is None:
        with _scheduler_lock:
            if _scheduler is None:
                _scheduler = WorkScheduler.autodetected()
                log_event(logger, logging.INFO, "scheduler.initialized")
    return _scheduler
