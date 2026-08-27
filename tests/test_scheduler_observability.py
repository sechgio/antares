from __future__ import annotations

import threading

import pytest


def test_scheduler_metrics_include_queue_age_and_execution_timings() -> None:
    from backend.core.scheduler import WorkScheduler

    started = threading.Event()
    release = threading.Event()
    scheduler = WorkScheduler(
        light_workers=1,
        heavy_workers=1,
        heavy_queue_limit=1,
        light_queue_limit=1,
    )

    def blocker() -> None:
        started.set()
        release.wait(timeout=5)

    try:
        first = scheduler.submit_heavy(blocker)
        assert started.wait(timeout=1)
        queued = scheduler.submit_heavy(lambda: None)

        queued_metrics = scheduler.metrics()
        assert queued_metrics["heavy_queued"] == 1
        assert queued_metrics["heavy_queue_age_ms"] >= 0
        assert queued_metrics["heavy_queue_wait_count"] >= 1

        release.set()
        assert first.result(timeout=2) is None
        assert queued.result(timeout=2) is None

        metrics = scheduler.metrics()
        assert metrics["heavy_queue_wait_count"] >= 2
        assert metrics["heavy_queue_wait_last_ms"] >= 0
        assert metrics["heavy_queue_wait_max_ms"] >= metrics["heavy_queue_wait_last_ms"]
        assert metrics["heavy_run_count"] == 2
        assert metrics["heavy_run_last_ms"] >= 0
        assert metrics["heavy_run_max_ms"] >= metrics["heavy_run_last_ms"]
        assert isinstance(metrics["snapshot_at"], str)
    finally:
        release.set()
        scheduler.shutdown(wait=True)


def test_scheduler_counts_worker_errors_without_exposing_exception_text() -> None:
    from backend.core.scheduler import WorkScheduler

    scheduler = WorkScheduler(light_workers=1, heavy_workers=1, heavy_queue_limit=0)
    try:
        future = scheduler.submit_light(lambda: (_ for _ in ()).throw(ValueError("secret/path")))
        with pytest.raises(ValueError, match="secret/path"):
            future.result(timeout=2)

        metrics = scheduler.metrics()
        assert metrics["light_worker_errors"] == 1
        assert metrics["light_run_count"] == 1
    finally:
        scheduler.shutdown(wait=True)


def test_scheduler_rejection_emits_low_cardinality_event(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.core import scheduler as scheduler_module

    events: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(
        scheduler_module,
        "log_event",
        lambda _logger, _level, event, **fields: events.append((event, fields)),
    )
    scheduler = scheduler_module.WorkScheduler(light_workers=1, heavy_workers=1, heavy_queue_limit=0)
    release = threading.Event()
    try:
        scheduler.submit_heavy(release.wait)
        with pytest.raises(scheduler_module.SchedulerBusy):
            scheduler.submit_heavy(release.wait)

        assert events == [("scheduler.rejected", {
            "lane": "heavy",
            "outcome": "rejected",
            "reason": "heavy_queue_full",
        })]
    finally:
        release.set()
        scheduler.shutdown(wait=True)
