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
