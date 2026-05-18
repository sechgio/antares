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
