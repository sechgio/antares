"""Ciclo de vida observable de los jobs sin exponer sus parámetros."""

from __future__ import annotations

import time

from backend.core import jobs


def test_job_lifecycle_records_timestamps_duration_and_outcome(monkeypatch) -> None:
    events: list[tuple[str, dict]] = []

    def capture(_logger, _level, event, *, message=None, **fields) -> None:
        events.append((event, {"message": message, **fields}))

    monkeypatch.setattr(jobs, "log_event", capture)
    manager = jobs.JobManager(max_concurrent=1)

    def target(job) -> None:
        time.sleep(0.01)
        with job.state._lock:
            job.state.ok_count = 1
            job.state.total = 1
            job.state.progress = 100

    result = manager.create_job("conversion", {"files": ["C:\\Users\\Alice\\private.png"]}, target, job_id="job-1")
    assert result == {"started": True, "job_id": "job-1"}
    job = manager.get_job("job-1")
    assert job is not None and job.thread is not None
    job.thread.join(timeout=2)

    assert job.started_at is not None
    assert job.finished_at is not None
    assert job.duration_ms is not None and job.duration_ms >= 0
    summary = job.to_dict()
    assert summary["started_at"] == job.started_at
    assert summary["finished_at"] == job.finished_at
    assert summary["duration_ms"] == job.duration_ms
    assert [event[0] for event in events] == ["job.started", "job.finished"]
    assert events[-1][1]["outcome"] == "success"
    assert events[-1][1]["job_id"] == "job-1"
    assert events[-1][1]["method"] == "conversion"
    assert "private.png" not in str(events)


def test_failed_job_emits_failed_lifecycle_event(monkeypatch) -> None:
    events: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        jobs,
        "log_event",
        lambda _logger, _level, event, *, message=None, **fields: events.append(
            (event, {"message": message, **fields})
        ),
    )
    manager = jobs.JobManager(max_concurrent=1)

    def target(_job) -> None:
        raise RuntimeError("boom")

    manager.create_job("conversion", {}, target, job_id="job-failed")
    job = manager.get_job("job-failed")
    assert job is not None and job.thread is not None
    job.thread.join(timeout=2)

    assert [event[0] for event in events] == ["job.started", "job.failed", "job.finished"]
    assert events[1][1]["outcome"] == "failed"
    assert events[2][1]["outcome"] == "failed"
