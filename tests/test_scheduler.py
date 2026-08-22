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


def test_light_work_does_not_wait_behind_queued_heavy_work() -> None:
    from backend.core.scheduler import WorkScheduler

    release = threading.Event()
    scheduler = WorkScheduler(light_workers=1, heavy_workers=1, heavy_queue_limit=1)

    try:
        scheduler.submit_heavy(release.wait)
        scheduler.submit_heavy(release.wait)

        light = scheduler.submit_light(lambda: "ok")

        assert light.result(timeout=1) == "ok"
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
    started = threading.Event()

    def blocker() -> None:
        started.set()
        release.wait(timeout=5)

    scheduler = WorkScheduler(light_workers=1, heavy_workers=1, heavy_queue_limit=1)
    try:
        scheduler.submit_heavy(blocker)
        assert started.wait(timeout=1)

        # The only heavy worker is busy, so this future remains queued.
        queued = scheduler.submit_heavy(lambda: None)
        assert scheduler.metrics()["heavy_outstanding"] == scheduler.heavy_capacity

        assert queued.cancel() is True

        # El slot liberado debe permitir un nuevo submit sin SchedulerBusy.
        extra = scheduler.submit_heavy(lambda: None)
        assert extra is not None
        assert scheduler.metrics()["heavy_outstanding"] == scheduler.heavy_capacity
        assert scheduler.metrics()["heavy_cancelled"] == 1
    finally:
        release.set()
        scheduler.shutdown(wait=True)

def test_heavy_run_concurrency_capped_at_heavy_workers() -> None:
    """Outstanding may fill capacity, but concurrent heavy fn execution must
    stay ≤ heavy_workers even when the unified pool is larger."""
    from backend.core.scheduler import SchedulerBusy, WorkScheduler

    heavy_workers = 2
    queue_limit = 4
    release = threading.Event()
    active = 0
    max_active = 0
    lock = threading.Lock()
    saw_capacity = threading.Event()

    def blocker() -> None:
        nonlocal active, max_active
        with lock:
            active += 1
            if active > max_active:
                max_active = active
            if active == heavy_workers:
                saw_capacity.set()
        release.wait(timeout=5)
        with lock:
            active -= 1

    # The heavy executor caps execution at heavy_workers.
    scheduler = WorkScheduler(
        light_workers=4,
        heavy_workers=heavy_workers,
        heavy_queue_limit=queue_limit,
    )
    futures = []
    try:
        for _ in range(scheduler.heavy_capacity):
            futures.append(scheduler.submit_heavy(blocker))

        assert scheduler.heavy_capacity == heavy_workers + queue_limit
        assert saw_capacity.wait(timeout=2)

        # Steady state: capacity reserved, but only heavy_workers running.
        deadline = time.monotonic() + 0.3
        while time.monotonic() < deadline:
            metrics = scheduler.metrics()
            with lock:
                assert active <= heavy_workers
                assert max_active <= heavy_workers
            assert metrics["heavy_active"] <= heavy_workers
            assert metrics["heavy_outstanding"] == scheduler.heavy_capacity
            assert metrics["heavy_run_slots"] == heavy_workers - metrics["heavy_active"]
            time.sleep(0.01)

        with pytest.raises(SchedulerBusy):
            scheduler.submit_heavy(blocker)

        metrics = scheduler.metrics()
        assert metrics["heavy_outstanding"] == scheduler.heavy_capacity
        assert metrics["heavy_active"] <= heavy_workers
        assert metrics["heavy_queued"] >= queue_limit
        with lock:
            assert max_active == heavy_workers
    finally:
        release.set()
        for fut in futures:
            fut.result(timeout=5)
        scheduler.shutdown(wait=True)


def test_light_queue_is_bounded() -> None:
    from backend.core.scheduler import SchedulerBusy, WorkScheduler

    started = threading.Event()
    release = threading.Event()
    scheduler = WorkScheduler(light_workers=1, heavy_workers=1, heavy_queue_limit=1, light_queue_limit=1)

    try:
        # 1 worker + 1 queue slot: the third submit must be rejected.
        scheduler.submit_light(lambda: (started.set(), release.wait(5)))
        assert started.wait(2), "first light task did not start"

        scheduler.submit_light(lambda: "queued")

        with pytest.raises(SchedulerBusy) as excinfo:
            scheduler.submit_light(lambda: "overflow")
        assert "light_queue_full" in str(excinfo.value)

        metrics = scheduler.metrics()
        assert metrics["light_capacity"] == 2
        assert metrics["light_rejected"] == 1
    finally:
        release.set()
        scheduler.shutdown(wait=True)

    # After the blocked task finishes, a new submit must succeed (slot freed).
    scheduler = WorkScheduler(light_workers=1, heavy_workers=1, heavy_queue_limit=1, light_queue_limit=1)
    try:
        future = scheduler.submit_light(lambda: "ok")
        assert future.result(timeout=2) == "ok"
    finally:
        scheduler.shutdown(wait=True)


def test_cancelled_queued_light_future_releases_slot() -> None:
    from backend.core.scheduler import WorkScheduler

    started = threading.Event()
    release = threading.Event()
    scheduler = WorkScheduler(light_workers=1, heavy_workers=1, heavy_queue_limit=1, light_queue_limit=0)

    try:
        scheduler.submit_light(lambda: (started.set(), release.wait(5)))
        assert started.wait(2), "first light task did not start"

        queued = scheduler.submit_light(lambda: "queued")
        queued.cancel()

        metrics = scheduler.metrics()
        assert metrics["light_outstanding"] == 1, "cancelled queued light future must release its slot"
    finally:
        release.set()
        scheduler.shutdown(wait=True)

def test_detect_limits_allows_8_heavy_on_high_ram(monkeypatch) -> None:
    from backend.core import scheduler as sched

    monkeypatch.setattr(sched.os, 'cpu_count', lambda: 16)

    class _Mem:
        available = 20 * (1024 ** 3)

    class _Psutil:
        @staticmethod
        def virtual_memory():
            return _Mem()

    monkeypatch.setitem(__import__('sys').modules, 'psutil', _Psutil())
    _light, heavy, queue, light_queue = sched._detect_limits()
    assert heavy <= 8
    assert heavy >= 2
    assert heavy == 8, f'expected heavy_workers=8 on high RAM, got {heavy}'
    assert queue >= heavy
    assert light_queue >= 16


def test_detect_limits_caps_at_6_below_16gb(monkeypatch) -> None:
    from backend.core import scheduler as sched

    monkeypatch.setattr(sched.os, 'cpu_count', lambda: 16)

    class _Mem:
        available = 10 * (1024 ** 3)

    class _Psutil:
        @staticmethod
        def virtual_memory():
            return _Mem()

    monkeypatch.setitem(__import__('sys').modules, 'psutil', _Psutil())
    _light, heavy, _queue, _light_queue = sched._detect_limits()
    assert heavy <= 6


def test_submit_heavy_releases_slot_when_executor_submit_raises() -> None:
    """Si executor.submit lanza (pool apagado / broken thread), el semáforo
    _heavy_slots y el contador _heavy_outstanding deben liberarse para no
    reducir heavy_capacity permanentemente en cada fallo (regresión del leak)."""
    from backend.core.scheduler import WorkScheduler

    scheduler = WorkScheduler(light_workers=1, heavy_workers=2, heavy_queue_limit=1)
    capacity = scheduler.heavy_capacity
    scheduler.shutdown(wait=True)

    with pytest.raises(RuntimeError):
        scheduler.submit_heavy(lambda: None)

    metrics = scheduler.metrics()
    assert metrics["heavy_outstanding"] == 0
    # B7: un submit fallido no es un submit — el contador no debe inflarse
    # (antes quedaba incrementado para siempre en cada fallo).
    assert metrics["heavy_submitted"] == 0
    for _ in range(capacity):
        assert scheduler._heavy_slots.acquire(blocking=False), "semaphore permit was leaked"


def test_submit_light_does_not_inflate_submitted_when_executor_submit_raises() -> None:
    """B7 (lane light): si executor.submit lanza, outstanding se libera y el
    contador submitted NO debe quedar incrementado — un fallo de submit no
    puede ensuciar la telemetría para el resto de la sesión."""
    from backend.core.scheduler import WorkScheduler

    scheduler = WorkScheduler(light_workers=1, heavy_workers=1, heavy_queue_limit=0)
    scheduler.shutdown(wait=True)

    with pytest.raises(RuntimeError):
        scheduler.submit_light(lambda: None)

    metrics = scheduler.metrics()
    assert metrics["light_outstanding"] == 0
    assert metrics["light_submitted"] == 0
    assert scheduler._light_slots.acquire(blocking=False), "semaphore permit was leaked"
