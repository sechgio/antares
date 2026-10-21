from __future__ import annotations

from pathlib import Path

import pytest

from backend.core.editor.jobs import (
    EDITOR_JOB_TYPES,
    cancel_editor_job,
    editor_job_status,
    is_editor_job,
    start_import_job,
)
from backend.core.jobs import JobManager


@pytest.fixture()
def manager(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> JobManager:
    mgr = JobManager()
    jobs_dir = tmp_path / "jobs"
    jobs_dir.mkdir()
    monkeypatch.setattr("backend.core.editor.jobs._jobs_dir", lambda: jobs_dir)
    return mgr


def _wait_done(mgr: JobManager, job_id: str, timeout_s: float = 10.0) -> None:
    import time

    deadline = time.time() + timeout_s
    while time.time() < deadline:
        job = mgr.get_job(job_id)
        if job is None or not job.state.running:
            return
        time.sleep(0.05)
    raise AssertionError("el job no terminó a tiempo")


def test_import_job_types_are_registered() -> None:
    assert "editor_import" in EDITOR_JOB_TYPES


def test_start_returns_job_id_promptly(manager: JobManager, tmp_path: Path) -> None:
    result = start_import_job(manager, [], assets_dir=tmp_path / "assets")
    assert result["started"] is True
    assert result["jobId"].startswith("editor_import_")


def test_empty_import_completes_without_assets(manager: JobManager, tmp_path: Path) -> None:
    result = start_import_job(manager, [], assets_dir=tmp_path / "assets")
    job_id = result["jobId"]
    _wait_done(manager, job_id)
    status = editor_job_status(job_id, manager)
    assert status["running"] is False
    assert status["state"] in {"completed", "failed"}
    assert status["stages"][0] == "validando"


def test_status_persisted_record_exists_after_start(manager: JobManager, tmp_path: Path) -> None:
    result = start_import_job(manager, [], assets_dir=tmp_path / "assets")
    record_path = tmp_path / "jobs" / f"{result['jobId']}.json"
    assert record_path.is_file()
    import json

    record = json.loads(record_path.read_text(encoding="utf-8"))
    assert record["type"] == "editor_import"
    assert record["fileCount"] == 0


def test_status_of_unknown_job_raises(manager: JobManager) -> None:
    with pytest.raises(KeyError):
        editor_job_status("editor_import_noexiste", manager)


def test_invalid_token_fails_the_job_gracefully(manager: JobManager, tmp_path: Path) -> None:
    result = start_import_job(manager, ["ruta/relativa.mp4"], assets_dir=tmp_path / "assets")
    job_id = result["jobId"]
    _wait_done(manager, job_id)
    status = editor_job_status(job_id, manager)
    assert status["running"] is False
    assert len(status["failed"]) == 1
    assert status["state"] in {"failed", "partial"}


def test_missing_file_fails_the_job_gracefully(manager: JobManager, tmp_path: Path) -> None:
    result = start_import_job(
        manager, ["C:/no/existe/clip.mp4"], assets_dir=tmp_path / "assets"
    )
    job_id = result["jobId"]
    _wait_done(manager, job_id)
    status = editor_job_status(job_id, manager)
    assert status["failed"][0]["reason"]


def test_cancel_editor_job_marks_cancel(manager: JobManager, tmp_path: Path) -> None:
    result = start_import_job(manager, [], assets_dir=tmp_path / "assets")
    job_id = result["jobId"]
    outcome = cancel_editor_job(job_id, manager)
    assert outcome.get("cancelled") is True or outcome.get("reason") == "job_not_running"


def test_cancel_rejects_foreign_jobs(manager: JobManager) -> None:
    with pytest.raises(KeyError):
        cancel_editor_job("conversion_default", manager)


def test_is_editor_job_discriminates(manager: JobManager, tmp_path: Path) -> None:
    assert is_editor_job("editor_import_abc123") is True
    assert is_editor_job("conversion_default") is False
    assert is_editor_job("canvas_default") is False


def test_queue_full_is_reported_not_raised(manager: JobManager, tmp_path: Path) -> None:
    manager.max_concurrent = 1
    blocker = manager.create_job(
        "editor_import",
        {"files": []},
        lambda job: __import__("time").sleep(2),
        job_id="editor_import_blocker",
    )
    assert blocker["started"] is True
    result = start_import_job(manager, [], assets_dir=tmp_path / "assets")
    assert result["started"] is False
    assert result["reason"] == "max_concurrent_reached"
    manager.cancel_job("editor_import_blocker")


@pytest.mark.parametrize("job_type", ["export", "effect"])
@pytest.mark.parametrize("queue_limit", [0, 1])
def test_editor_heavy_jobs_share_capacity_and_cancel_before_execution(
    manager: JobManager, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, job_type: str, queue_limit: int,
) -> None:
    import threading

    from backend.core.editor import jobs
    from backend.core.scheduler import WorkScheduler

    scheduler = WorkScheduler(light_workers=1, heavy_workers=1, heavy_queue_limit=queue_limit)
    monkeypatch.setattr(jobs, "get_scheduler", lambda: scheduler)
    entered = threading.Event()
    release = threading.Event()
    executed = threading.Event()

    def blocker() -> None:
        entered.set()
        assert release.wait(10)

    blocker_future = scheduler.submit_heavy(blocker)
    assert blocker_future is not None
    assert entered.wait(2)
    monkeypatch.setattr(jobs, "run_export_job", lambda *_args, **_kwargs: executed.set() or {})
    monkeypatch.setattr(jobs, "run_effect_job", lambda *_args: executed.set() or {})
    try:
        if job_type == "export":
            started = jobs.start_export_job(manager, {}, output=tmp_path / "export.mp4")
        else:
            started = jobs.start_effect_job(manager, {}, "chromakey")
        assert started["started"] is True
        assert not executed.wait(0.1)
        assert manager.cancel_job(started["jobId"])["cancelled"] is True
        _wait_done(manager, started["jobId"], timeout_s=2)
        assert not executed.is_set()
        assert not manager.get_job(started["jobId"]).state.running
    finally:
        release.set()
        blocker_future.result(timeout=2)
        scheduler.shutdown()


@pytest.mark.parametrize("job_type", ["export", "effect"])
def test_editor_heavy_jobs_run_after_shared_capacity_is_released(
    manager: JobManager, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, job_type: str,
) -> None:
    import threading

    from backend.core.editor import jobs
    from backend.core.scheduler import WorkScheduler

    scheduler = WorkScheduler(light_workers=1, heavy_workers=1, heavy_queue_limit=1)
    monkeypatch.setattr(jobs, "get_scheduler", lambda: scheduler)
    release = threading.Event()
    executed = threading.Event()
    scheduler.submit_heavy(lambda: release.wait(5))
    monkeypatch.setattr(jobs, "run_export_job", lambda *_args, **_kwargs: executed.set() or {"output": "ok"})
    monkeypatch.setattr(jobs, "run_effect_job", lambda *_args: executed.set() or {"output": "ok"})
    try:
        if job_type == "export":
            started = jobs.start_export_job(manager, {}, output=tmp_path / "export.mp4")
        else:
            started = jobs.start_effect_job(manager, {}, "chromakey")
        assert not executed.wait(0.1)
        release.set()
        assert executed.wait(2)
        _wait_done(manager, started["jobId"])
        job = manager.get_job(started["jobId"])
        assert job is not None
        assert not job.state.running
        assert job.state.err_count == 0
    finally:
        release.set()
        scheduler.shutdown()
