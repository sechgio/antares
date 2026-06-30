from __future__ import annotations

import threading
import time

import pytest


def test_heavy_queue_is_bounded() -> None:
    from backend.core.scheduler import SchedulerBusy, WorkScheduler

    release = threading.Event()
    scheduler = WorkScheduler(light_workers=1, heavy_workers=1, heavy_queue_limit=1)

    try:
        scheduler.submit_heavy(release.wait)
        scheduler.submit_heavy(release.wait)

        with pytest.raises(SchedulerBusy):
            scheduler.submit_heavy(release.wait)

        metrics = scheduler.metrics()
        assert metrics["heavy_capacity"] == 2
        assert metrics["heavy_outstanding"] == 2
        assert metrics["heavy_rejected"] == 1
    finally:
        release.set()
        scheduler.shutdown(wait=True)


def test_light_work_runs_while_heavy_capacity_is_full() -> None:
    from backend.core.scheduler import WorkScheduler

    release = threading.Event()
    scheduler = WorkScheduler(light_workers=1, heavy_workers=1, heavy_queue_limit=0)

    try:
        scheduler.submit_heavy(release.wait)
        future = scheduler.submit_light(lambda: "ok")

        assert future.result(timeout=1) == "ok"
    finally:
        release.set()
        scheduler.shutdown(wait=True)


def test_blocking_heavy_submit_stops_when_cancel_requested() -> None:
    from backend.core.scheduler import WorkScheduler

    release = threading.Event()
    cancelled = threading.Event()
    scheduler = WorkScheduler(light_workers=1, heavy_workers=1, heavy_queue_limit=0)

    try:
        scheduler.submit_heavy(release.wait)

        cancelled.set()
        started = time.monotonic()
        second = scheduler.submit_heavy(
            release.wait,
            block=True,
            cancel_check=cancelled.is_set,
        )
        elapsed = time.monotonic() - started

        assert second is None
        assert elapsed < 1
        assert scheduler.metrics()["heavy_cancelled_waits"] == 1
    finally:
        release.set()
        scheduler.shutdown(wait=True)


def test_cancelled_queued_heavy_future_releases_slot() -> None:
    """Cancelar un heavy future antes de que arranque debe devolver su slot al
    budget. Sin el done-callback, el finally de _wrapped nunca corre y el slot
    queda perdido para toda la sesión (regresión del job-cancellation)."""
    from backend.core.scheduler import WorkScheduler

    release = threading.Event()
    started = {"n": 0}
    started_lock = threading.Lock()

    def blocker() -> None:
        with started_lock:
            started["n"] += 1
        release.wait(timeout=5)

    scheduler = WorkScheduler(light_workers=1, heavy_workers=1, heavy_queue_limit=1)
    try:
        # Ocupa todos los threads del pool para que los heavy futures queden
        # encolados (PENDING) en lugar de arrancar.
        for _ in range(scheduler._max_total_workers):
            scheduler.submit_light(blocker)
        while started["n"] < scheduler._max_total_workers:
            time.sleep(0.001)

        # Reserva toda la capacidad heavy con futures que aún no arrancaron.
        heavies = [scheduler.submit_heavy(lambda: None) for _ in range(scheduler.heavy_capacity)]
        assert scheduler.metrics()["heavy_outstanding"] == scheduler.heavy_capacity

        # Cancela uno encolado: ningún thread libre => sigue PENDING => cancel() True.
        assert heavies[0].cancel() is True

        # El slot liberado debe permitir un nuevo submit sin SchedulerBusy.
        extra = scheduler.submit_heavy(lambda: None)
        assert extra is not None
        assert scheduler.metrics()["heavy_outstanding"] == scheduler.heavy_capacity
        assert scheduler.metrics()["heavy_cancelled"] == 1
    finally:
        release.set()
        scheduler.shutdown(wait=True)
