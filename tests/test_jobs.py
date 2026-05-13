"""Tests for the concurrent jobs system.

Uses only synchronous tests to avoid pytest hanging on daemon threads.
Thread-safety is verified separately in test_race_condition.py.
"""
from __future__ import annotations

from backend.core.jobs import Job, JobManager, DEFAULT_JOB_ID
from backend.core.state import ProcessState


class TestProcessState:
    def test_reset_state_with_explicit_state(self):
        from backend.handlers.common import reset_state
        state = ProcessState(running=True, progress=50, ok_count=10, err_count=2)
        reset_state(state)
        assert state.running is False
        assert state.progress == 0
        assert state.ok_count == 0
        assert state.err_count == 0
        assert state.cancel_requested is False
        assert state.logs == []


class TestJob:
    def test_to_dict_returns_summary(self):
        state = ProcessState(running=True, progress=42, total=100, ok_count=5, err_count=1)
        job = Job(id="test_job", job_type="conversion", state=state)
        d = job.to_dict()
        assert d["id"] == "test_job"
        assert d["job_type"] == "conversion"
        assert d["running"] is True
        assert d["progress"] == 42
        assert d["total"] == 100
        assert d["ok_count"] == 5
        assert d["err_count"] == 1

    def test_to_dict_detail_includes_logs_and_params(self):
        state = ProcessState()
        state.logs.append({"message": "test", "tag": "info"})
        job = Job(id="detail_job", job_type="conversion", state=state, params={"files": ["a.jpg"]})
        d = job.to_dict_detail()
        assert "logs" in d
        assert len(d["logs"]) == 1
        assert d["params"] == {"files": ["a.jpg"]}

    def test_to_dict_shows_not_running_by_default(self):
        job = Job(id="idle", job_type="conversion")
        d = job.to_dict()
        assert d["running"] is False
        assert d["progress"] == 0


class TestJobManager:
    def test_cancel_nonexistent_job(self):
        mgr = JobManager()
        result = mgr.cancel_job("nonexistent")
        assert result["cancelled"] is False
        assert result["reason"] == "job_not_found"

    def test_get_nonexistent_job(self):
        mgr = JobManager()
        assert mgr.get_job("nope") is None

    def test_list_jobs_empty(self):
        mgr = JobManager()
        assert mgr.list_jobs() == []

    def test_list_jobs_by_type(self):
        mgr = JobManager()
        j1 = Job(id="a", job_type="conversion")
        j2 = Job(id="b", job_type="formato")
        mgr._jobs["a"] = j1
        mgr._jobs["b"] = j2
        conv = mgr.list_jobs(job_type="conversion")
        assert len(conv) == 1
        assert conv[0].job_type == "conversion"

    def test_cleanup_preserves_default_job(self):
        mgr = JobManager()
        j = Job(id=DEFAULT_JOB_ID, job_type="conversion")
        j.state.running = False
        mgr._jobs[DEFAULT_JOB_ID] = j
        removed = mgr.cleanup_completed(max_remaining=0)
        assert removed == 0
        assert mgr.get_job(DEFAULT_JOB_ID) is not None

    def test_cleanup_removes_old_completed(self):
        mgr = JobManager()
        for i in range(5):
            j = Job(id=f"c{i}", job_type="conversion")
            j.state.running = False
            mgr._jobs[f"c{i}"] = j
        removed = mgr.cleanup_completed(max_remaining=2)
        assert removed == 3
        assert len(mgr.list_jobs()) == 2

    def test_default_job_id_constant(self):
        assert DEFAULT_JOB_ID == "default"

    def test_max_concurrent_default(self):
        mgr = JobManager()
        assert mgr.max_concurrent == 4

    def test_max_concurrent_custom(self):
        mgr = JobManager(max_concurrent=8)
        assert mgr.max_concurrent == 8
