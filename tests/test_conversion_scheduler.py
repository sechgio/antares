from __future__ import annotations

import threading
import time
from concurrent.futures import Future

from backend.core.jobs import Job
from backend.handlers import conversion


class _ImmediateFuture:
    def __init__(self, result):
        self._result = result

    def result(self):
        return self._result

    def cancelled(self):
        return False

    def cancel(self):
        return False


class _RecordingScheduler:
    def __init__(self) -> None:
        self.submitted: list[tuple[str, str, bool]] = []

    def submit_heavy(self, fn, task, *, block=False, cancel_check=None):  # type: ignore[no-untyped-def]
        self.submitted.append(task)
        return _ImmediateFuture(fn(task))


def test_conversion_prepares_work_incrementally(monkeypatch) -> None:
    scheduler = _RecordingScheduler()
    seen_batches: list[list[str]] = []

    monkeypatch.setattr(conversion, "get_scheduler", lambda: scheduler)
    monkeypatch.setattr(conversion, "es_video", lambda _path: False)
    monkeypatch.setattr(conversion, "convertir_imagen", lambda *args, **kwargs: None)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 2)

    def fake_lookup(codes):  # type: ignore[no-untyped-def]
        seen_batches.append(list(codes))
        return {}

    monkeypatch.setattr("backend.core.database.buscar_lote_por_codigos", fake_lookup)

    job = Job(
        id="batch",
        job_type="conversion",
        params={
            "files": [f"C:/tmp/{idx}.jpg" for idx in range(5)],
            "destino": "C:/out",
            "formato": "JPEG",
            "usar_rename": True,
        },
    )
    conversion._run_conversion_job(job)

    assert [len(batch) for batch in seen_batches] == [2, 2, 1]
    assert len(scheduler.submitted) == 5


def test_conversion_cancel_releases_visible_state_without_waiting_for_slow_workers(monkeypatch) -> None:
    release = threading.Event()

    class _SlowScheduler:
        def submit_heavy(self, fn, task, *, block=False, cancel_check=None):  # type: ignore[no-untyped-def]
            future: Future = Future()

            def _complete_later() -> None:
                release.wait(timeout=5)
                if not future.cancelled():
                    future.set_result((True, "a.jpg", ""))

            threading.Thread(target=_complete_later, daemon=True).start()
            return future

    monkeypatch.setattr(conversion, "get_scheduler", lambda: _SlowScheduler())
    monkeypatch.setattr(conversion, "es_video", lambda _path: False)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 1)
    monkeypatch.setattr(conversion, "_CANCEL_GRACE_SECONDS", 0.05)
    monkeypatch.setattr("backend.core.database.buscar_lote_por_codigos", lambda _codes: {})

    job = Job(
        id="slow",
        job_type="conversion",
        params={
            "files": ["C:/tmp/a.jpg"],
            "destino": "C:/out",
            "formato": "JPEG",
            "usar_rename": False,
        },
    )
    with job.state._lock:
        job.state.cancel_requested = True

    started = time.monotonic()
    conversion._run_conversion_job(job)
    elapsed = time.monotonic() - started
    release.set()

    assert elapsed < 0.5
    assert job.state.running is False
    assert job.result == {"ok_count": 0, "err_count": 0, "cancelled": True}
