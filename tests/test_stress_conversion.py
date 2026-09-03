
from __future__ import annotations

import threading

import pytest

from backend.core.jobs import Job, JobManager
from backend.handlers import conversion


class _ImmediateFuture:
    def __init__(self, result: tuple[bool, str, str]) -> None:
        self._result = result

    def result(self) -> tuple[bool, str, str]:
        return self._result

    def cancelled(self) -> bool:
        return False

    def cancel(self) -> bool:
        return False


class _ImmediateScheduler:
    def submit_heavy(self, fn, task, *, block=False, cancel_check=None):  # type: ignore[no-untyped-def]
        return _ImmediateFuture(fn(task))


def _stress_params(tmp_path, file_count: int) -> dict:
    dest = tmp_path / "out"
    dest.mkdir()
    return {
        "files": [str(tmp_path / f"img_{index:05d}.jpg") for index in range(file_count)],
        "destino": str(dest),
        "conversion_enabled": False,
        "usar_rename": False,
        "locale": "es",
    }


def _run_conversion_stress(monkeypatch, tmp_path, file_count: int) -> None:
    monkeypatch.setattr(conversion, "get_scheduler", lambda: _ImmediateScheduler())
    monkeypatch.setattr(conversion, "es_video", lambda _path: False)
    monkeypatch.setattr(conversion, "copiar_archivo", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("backend.core.history.save_run", lambda **_kwargs: None)
    monkeypatch.setattr(conversion, "send_notification", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 500)

    job = Job(
        id=f"stress-{file_count}",
        job_type="conversion",
        params=_stress_params(tmp_path, file_count),
    )
    with job.state._lock:
        job.state.running = True
        job.state.total = file_count

    conversion._run_conversion_job(job)

    assert job.result is not None
    assert job.result["ok_count"] == file_count
    assert job.result["err_count"] == 0
    assert job.result["cancelled"] is False
    with job.state._lock:
        assert job.state.progress == 100


def test_conversion_queue_accepts_1000_files(monkeypatch, tmp_path) -> None:
    _run_conversion_stress(monkeypatch, tmp_path, 1000)


@pytest.mark.slow
def test_conversion_queue_accepts_10k_files(monkeypatch, tmp_path) -> None:
    _run_conversion_stress(monkeypatch, tmp_path, 10_000)


@pytest.mark.slow
def test_conversion_copy_real_io_small_files(monkeypatch, tmp_path) -> None:
    import time

    n = 200
    src_dir = tmp_path / "src"
    src_dir.mkdir()
    files: list[str] = []
    payload = b"\xff\xd8\xff\xd9" + (b"x" * 64)
    for index in range(n):
        path = src_dir / f"img_{index:05d}.jpg"
        path.write_bytes(payload)
        files.append(str(path))

    dest = tmp_path / "out"
    dest.mkdir()

    monkeypatch.setattr(conversion, "get_scheduler", lambda: _ImmediateScheduler())
    monkeypatch.setattr(conversion, "es_video", lambda _path: False)
    monkeypatch.setattr("backend.core.history.save_run", lambda **_kwargs: None)
    monkeypatch.setattr(conversion, "send_notification", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 500)

    rss0 = None
    proc = None
    try:
        import psutil

        proc = psutil.Process()
        rss0 = proc.memory_info().rss
    except Exception:
        proc = None
        rss0 = None

    t0 = time.perf_counter()
    job = Job(
        id="stress-io",
        job_type="conversion",
        params={
            "files": files,
            "destino": str(dest),
            "conversion_enabled": False,
            "usar_rename": False,
            "locale": "es",
        },
    )
    with job.state._lock:
        job.state.running = True
        job.state.total = n

    conversion._run_conversion_job(job)
    elapsed = time.perf_counter() - t0

    assert job.result is not None
    assert job.result["ok_count"] == n
    assert job.result["err_count"] == 0
    assert len(list(dest.glob("*.jpg"))) == n
    assert elapsed < 30.0, f"copy I/O too slow: {elapsed:.2f}s"
    if proc is not None and rss0 is not None:
        delta = proc.memory_info().rss - rss0
        assert delta < 200 * 1024 * 1024, f"RSS grew {delta} bytes"


def test_process_start_accepts_large_file_list(monkeypatch, tmp_path) -> None:
    mgr = JobManager(max_concurrent=2)
    monkeypatch.setattr(conversion, "get_job_manager", lambda: mgr)
    monkeypatch.setattr(conversion, "_run_conversion_job", lambda job: setattr(job, "result", {"ok_count": len(job.params["files"])}))

    params = _stress_params(tmp_path, 2500)
    result = conversion.process_start(params)

    assert result["started"] is True
    job = mgr.get_job(result["job_id"])
    assert job is not None
    job.thread.join(timeout=10)
    with job.state._lock:
        assert job.state.total == 2500


def test_two_conversion_jobs_run_in_parallel() -> None:
    entered = threading.Barrier(2, timeout=5)
    release = threading.Event()
    peak_running = {"value": 0}
    lock = threading.Lock()

    def _target(job: Job) -> None:
        with lock:
            peak_running["value"] = max(
                peak_running["value"],
                sum(1 for current in mgr._jobs.values() if current.state.running),
            )
        entered.wait()
        release.wait(timeout=5)
        job.result = {"ok_count": 1, "err_count": 0, "cancelled": False}

    mgr = JobManager(max_concurrent=4)
    first = mgr.create_job("conversion", {"files": ["a.jpg"]}, _target, job_id="parallel-a")
    second = mgr.create_job("conversion", {"files": ["b.jpg"]}, _target, job_id="parallel-b")

    assert first["started"] is True
    assert second["started"] is True

    release.set()
    mgr.get_job("parallel-a").thread.join(timeout=10)
    mgr.get_job("parallel-b").thread.join(timeout=10)

    assert peak_running["value"] >= 2
