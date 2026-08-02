"""Tests for the concurrent jobs system.

Uses only synchronous tests to avoid pytest hanging on daemon threads.
Thread-safety is verified separately in test_race_condition.py.
"""
from __future__ import annotations

from backend.core.jobs import DEFAULT_JOB_ID, MAX_COMPLETED_JOBS, Job, JobManager, resolve_job_id
from backend.core.state import ProcessState


class TestResolveJobId:
    def test_missing_key_falls_back_to_default(self):
        assert resolve_job_id({}) == DEFAULT_JOB_ID

    def test_none_value_falls_back_to_default(self):
        # Regression: str(None) used to leak "None" as the job id.
        assert resolve_job_id({"job_id": None}) == DEFAULT_JOB_ID

    def test_empty_string_kept_as_is(self):
        assert resolve_job_id({"job_id": ""}) == ""

    def test_string_value_kept_as_is(self):
        assert resolve_job_id({"job_id": "abc"}) == "abc"

    def test_int_value_coerced_to_string(self):
        assert resolve_job_id({"job_id": 123}) == "123"

    def test_custom_default(self):
        assert resolve_job_id({}, default="custom") == "custom"
        assert resolve_job_id({"job_id": None}, default="custom") == "custom"


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

    def test_process_status_omits_files_list(self):
        from backend.core.jobs import get_job_manager
        from backend.handlers.conversion import process_status

        mgr = get_job_manager()
        files = [f"C:/tmp/{i}.jpg" for i in range(50)]
        job = Job(
            id="status_slim",
            job_type="conversion",
            state=ProcessState(running=True, progress=10, ok_count=1, err_count=0),
            params={"files": files, "destino": "C:/out", "formato": "JPEG"},
        )
        job.state.logs.append({"message": "hi", "tag": "info"})
        mgr._jobs["status_slim"] = job

        status = process_status({"job_id": "status_slim"})
        assert status["running"] is True
        assert status["progress"] == 10
        assert status["ok_count"] == 1
        assert len(status["logs"]) == 1
        assert "files" not in (status.get("params") or {})
        assert status["params"]["file_count"] == 50
        assert status["params"]["destino"] == "C:/out"
        del mgr._jobs["status_slim"]

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

    def test_slim_completed_job_drops_files_list(self):
        files = [f"C:/tmp/{i}.jpg" for i in range(200)]
        job = Job(id="slim_me", job_type="conversion", params={"files": files, "destino": "C:/out"})
        JobManager._slim_completed_job(job)
        assert job.params["files"] == []
        assert job.params["file_count"] == 200
        assert job.params["destino"] == "C:/out"

    def test_process_status_uses_stored_file_count_after_slim(self):
        from backend.core.jobs import get_job_manager
        from backend.handlers.conversion import process_status

        files = [f"C:/tmp/{i}.jpg" for i in range(75)]
        job = Job(
            id="status_after_slim",
            job_type="conversion",
            params={"files": files, "destino": "C:/out", "formato": "jpg"},
        )
        JobManager._slim_completed_job(job)
        mgr = get_job_manager()
        mgr._jobs["status_after_slim"] = job
        try:
            status = process_status({"job_id": "status_after_slim"})
            assert status["params"]["file_count"] == 75
            assert status["params"]["destino"] == "C:/out"
            assert status["params"]["formato"] == "jpg"
            assert "files" not in (status.get("params") or {})
        finally:
            del mgr._jobs["status_after_slim"]

    def test_create_job_slims_params_after_finish(self):
        import time

        mgr = JobManager(max_concurrent=4)
        files = [f"C:/tmp/{i}.jpg" for i in range(100)]

        def _noop(job: Job) -> None:
            job.result = {"ok_count": len(job.params.get("files") or [])}

        started = mgr.create_job("conversion", {"files": files}, _noop, job_id="slim_after")
        assert started["started"] is True
        job = mgr.get_job("slim_after")
        assert job is not None
        assert job.thread is not None
        job.thread.join(timeout=2.0)
        # Allow finally block to run
        time.sleep(0.05)
        assert job.params.get("files") == []
        assert job.params.get("file_count") == 100
        assert job.result == {"ok_count": 100}

    def test_default_job_id_constant(self):
        assert DEFAULT_JOB_ID == "default"

    def test_max_concurrent_default(self):
        mgr = JobManager()
        assert mgr.max_concurrent == 4

    def test_max_concurrent_custom(self):
        mgr = JobManager(max_concurrent=8)
        assert mgr.max_concurrent == 8


class TestJobManagerCleanup:
    def test_cleanup_completed_respects_max_remaining(self):
        mgr = JobManager()
        assert mgr.cleanup_completed(max_remaining=MAX_COMPLETED_JOBS) == 0
