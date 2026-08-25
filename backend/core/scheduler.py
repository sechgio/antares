"""Global execution scheduler for light and heavy backend work."""

from __future__ import annotations

import logging
import os
import threading
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any

logger = logging.getLogger(__name__)

# Umbral de presión de memoria: por debajo de 1 GiB disponible se activa
# backpressure para canvas_save / light_queue y se alerta en metrics().
MEMORY_PRESSURE_THRESHOLD_BYTES: int = 1 * 1024 * 1024 * 1024
MEMORY_PRESSURE_THRESHOLD_MB: int = MEMORY_PRESSURE_THRESHOLD_BYTES // (1024 * 1024)
MEMORY_PRESSURE_RETRY_AFTER_MS: int = 2000


def _is_memory_pressure_disabled() -> bool:
    """Evitar flakiness en tests: PYTEST_CURRENT_TEST desactiva el throttle dinámico.

    Producción siempre activo salvo ``ANTARES_MEMORY_PRESSURE_DISABLE=1``.
    ``ANTARES_MEMORY_PRESSURE_FORCE=1`` fuerza el check incluso bajo pytest
    (útil para tests que *quieren* verificar el rechazo).
    """
    if os.environ.get("ANTARES_MEMORY_PRESSURE_DISABLE", "").strip().lower() in {"1", "true", "yes"}:
        return True
    if os.environ.get("ANTARES_MEMORY_PRESSURE_FORCE", "").strip().lower() in {"1", "true", "yes"}:
        return False
    return bool(os.environ.get("PYTEST_CURRENT_TEST"))


def _available_bytes() -> int | None:
    """Return ``psutil.virtual_memory().available`` or ``None`` if psutil missing."""
    try:
        import psutil

        return int(psutil.virtual_memory().available)
    except ImportError:
        return None
    except Exception:
        return None


def is_memory_pressure(*, threshold_bytes: int = MEMORY_PRESSURE_THRESHOLD_BYTES) -> bool:
    """True si la RAM disponible está bajo el umbral (default 1 GiB)."""
    if _is_memory_pressure_disabled():
        return False
    avail = _available_bytes()
    if avail is None:
        return False
    return avail < threshold_bytes


class SchedulerBusy(RuntimeError):
    """Raised when a scheduler work budget is already fully reserved.

    ``reason`` identifies the saturated lane (``heavy_queue_full`` /
    ``light_queue_full``) so callers can report the right queue.
    """

    def __init__(self, message: str = "heavy_queue_full", *, reason: str | None = None) -> None:
        super().__init__(message)
        self.reason = reason or message


def _light_queue_default(light_workers: int) -> int:
    """Default light queue budget: generous enough for normal IPC concurrency;
    a flooded renderer gets rejected instead of growing memory without limit."""
    return max(light_workers * 4, 16)


def _detect_limits() -> tuple[int, int, int, int]:
    """Return conservative `(light_workers, heavy_workers, heavy_queue_limit, light_queue_limit)`.

    Note: This is intentionally separate from JobManager._detect_max_concurrent().
    Scheduler controls thread-pool + heavy semaphore slots for individual
    work items (image conversion, PDF render, etc.).
    JobManager controls how many high-level user jobs can run concurrently.
    They compose (a job can submit multiple heavy tasks).
    See jobs.py for the other detector and backend/handlers/conversion.py
    for how they interact in practice.
    """
    cpu_count = os.cpu_count() or 2
    try:
        import psutil

        available_gb = psutil.virtual_memory().available / (1024 ** 3)
    except ImportError:
        available_gb = 4

    light_workers = max(2, min(cpu_count, 4))
    # Cap at 8 on high-RAM machines (≥16GB available); otherwise 6.
    # Use a looser RAM budget (~2GB/worker) so the higher cap is reachable.
    heavy_cap = 8 if available_gb >= 16 else 6
    ram_divisor = 2 if available_gb >= 16 else 3
    ram_limited_heavy = max(1, int(available_gb // ram_divisor))
    heavy_workers = max(2, min(max(1, cpu_count // 2), ram_limited_heavy, heavy_cap))
    heavy_queue_limit = max(heavy_workers, heavy_workers * 2)
    # Light work is latency-sensitive (previews, metadata reads) and each
    # queued closure retains its params, so bound the queue too.
    light_queue_limit = _light_queue_default(light_workers)
    # Bajo presión de RAM los closures grandes (canvas_save con documento entero)
    # pueden causar OOM si se encolan 16 a la vez. Reducir el budget en low-RAM.
    if available_gb < 1.0:
        # <1 GiB: 607MB libres reportado → limitar agresivo (4 es el mínimo útil)
        light_queue_limit = min(light_queue_limit, max(4, light_workers))
    elif available_gb < 2.0:
        light_queue_limit = min(light_queue_limit, max(8, light_workers * 2))
    return light_workers, heavy_workers, heavy_queue_limit, light_queue_limit


class WorkScheduler:
    """Coordinate light IPC work and resource-heavy backend tasks."""

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

        # Keep latency-sensitive work isolated from heavy tasks waiting to run.
        self._light_executor = ThreadPoolExecutor(
            max_workers=self.light_workers,
            thread_name_prefix="light-handler-pool",
        )
        self._heavy_executor = ThreadPoolExecutor(
            max_workers=self.heavy_workers,
            thread_name_prefix="heavy-handler-pool",
        )

        # Outstanding budget (running + queued reservations) for backpressure.
        self.heavy_capacity = self.heavy_workers + self.heavy_queue_limit
        self._heavy_slots = threading.BoundedSemaphore(self.heavy_capacity)
        self.light_capacity = self.light_workers + self.light_queue_limit
        self._light_slots = threading.BoundedSemaphore(self.light_capacity)
        self._lock = threading.RLock()
        self._heavy_cond = threading.Condition(self._lock)
        self._heavy_outstanding = 0
        self._heavy_active = 0
        self._heavy_rejected = 0
        self._heavy_cancelled_waits = 0
        self._heavy_cancelled = 0
        self._heavy_submitted = 0
        self._heavy_completed = 0
        self._light_outstanding = 0
        self._light_rejected = 0
        self._light_cancelled = 0
        self._light_submitted = 0
        self._light_completed = 0

    @classmethod
    def autodetected(cls) -> WorkScheduler:
        light_workers, heavy_workers, heavy_queue_limit, light_queue_limit = _detect_limits()
        return cls(
            light_workers=light_workers,
            heavy_workers=heavy_workers,
            heavy_queue_limit=heavy_queue_limit,
            light_queue_limit=light_queue_limit,
        )

    def submit_light(self, fn: Callable[..., Any], /, *args: Any, **kwargs: Any) -> Future:
        """Submit latency-sensitive work that should not wait behind heavy jobs.

        Bounded by ``light_capacity`` (workers + queue): when the budget is
        fully reserved, raises ``SchedulerBusy`` instead of queueing without
        limit (each queued closure retains its params in memory).

        Under memory pressure (<1 GiB available) the effective light queue is
        shrunk to ``max(4, light_workers)`` to avoid OOM from 16 large
        closures (canvas_save documents) waiting in the queue.
        """
        # Dynamic backpressure when RAM is low — check before touching the
        # semaphore so we don't reserve a slot we will immediately reject.
        if is_memory_pressure():
            effective_queue = min(self.light_queue_limit, max(4, self.light_workers))
            effective_capacity = self.light_workers + effective_queue
            with self._lock:
                if self._light_outstanding >= effective_capacity:
                    self._light_rejected += 1
                    raise SchedulerBusy("light_queue_full", reason="memory_pressure")
        if not self._light_slots.acquire(blocking=False):
            with self._lock:
                self._light_rejected += 1
            raise SchedulerBusy("light_queue_full")
        with self._lock:
            self._light_outstanding += 1

        def _wrapped() -> Any:
            try:
                return fn(*args, **kwargs)
            finally:
                with self._lock:
                    self._light_outstanding -= 1
                    self._light_completed += 1
                self._light_slots.release()

        try:
            future = self._light_executor.submit(_wrapped)
        except Exception:
            with self._lock:
                self._light_outstanding -= 1
            self._light_slots.release()
            raise

        # Contar solo submissions exitosos: un executor.submit que lanza no
        # debe inflar la telemetría para el resto de la sesión.
        with self._lock:
            self._light_submitted += 1

        def _release_if_cancelled(fut: Future) -> None:
            # A future cancelled before _wrapped ran never executes the finally
            # above, so release the reserved slot here (same invariant as the
            # heavy lane's cancellation handler).
            if fut.cancelled():
                with self._lock:
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
                self._notify_heavy()

        try:
            future = self._heavy_executor.submit(_wrapped)
        except Exception:
            with self._lock:
                self._heavy_outstanding -= 1
            self._heavy_slots.release()
            self._notify_heavy()
            raise

        # Contar solo submissions exitosos (misma invariante que la lane light).
        with self._lock:
            self._heavy_submitted += 1

        def _release_if_cancelled(fut: Future) -> None:
            if fut.cancelled():
                with self._lock:
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
            with self._lock:
                self._heavy_rejected += 1
            raise SchedulerBusy("heavy_queue_full")

        # Event-driven wait: wake on slot release, not poll.
        with self._heavy_cond:
            while True:
                if cancel_check and cancel_check():
                    self._heavy_cancelled_waits += 1
                    return False
                if self._heavy_slots.acquire(blocking=False):
                    return True
                self._heavy_cond.wait(timeout=0.2)

    def metrics(self) -> dict[str, Any]:
        """Return internal queue/worker metrics for diagnostics."""
        with self._lock:
            queued = max(0, self._heavy_outstanding - self._heavy_active)
            m: dict[str, Any] = {
                "light_workers": self.light_workers,
                "light_queue_limit": self.light_queue_limit,
                "light_capacity": self.light_capacity,
                "light_outstanding": self._light_outstanding,
                "light_queued": max(0, self._light_outstanding - self.light_workers),
                "light_rejected": self._light_rejected,
                "light_cancelled": self._light_cancelled,
                "light_submitted": self._light_submitted,
                "light_completed": self._light_completed,
                "heavy_workers": self.heavy_workers,
                "heavy_queue_limit": self.heavy_queue_limit,
                "heavy_capacity": self.heavy_capacity,
                "heavy_outstanding": self._heavy_outstanding,
                "heavy_active": self._heavy_active,
                "heavy_run_slots": max(0, self.heavy_workers - self._heavy_active),
                "heavy_queued": queued,
                "heavy_rejected": self._heavy_rejected,
                "heavy_cancelled_waits": self._heavy_cancelled_waits,
                "heavy_cancelled": self._heavy_cancelled,
                "heavy_submitted": self._heavy_submitted,
                "heavy_completed": self._heavy_completed,
            }
            try:
                import psutil
                vm = psutil.virtual_memory()
                m["system_ram_total_mb"] = int(vm.total / (1024 * 1024))
                m["system_ram_available_mb"] = int(vm.available / (1024 * 1024))
                m["system_ram_percent"] = int(vm.percent)
            except ImportError:
                pass
            # Alerta de presión de memoria para dashboards (auditoría RAM 92% → 1 línea).
            avail_mb = m.get("system_ram_available_mb")
            m["memory_pressure"] = bool(avail_mb is not None and avail_mb < MEMORY_PRESSURE_THRESHOLD_MB)
            m["memory_alert"] = (
                f"low_ram:{avail_mb}MB<{MEMORY_PRESSURE_THRESHOLD_MB}MB" if m["memory_pressure"] else None
            )
            return m
    def shutdown(self, *, wait: bool = True) -> None:
        """Shut down the light and heavy executors."""
        self._light_executor.shutdown(wait=wait, cancel_futures=True)
        self._heavy_executor.shutdown(wait=wait, cancel_futures=True)


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
