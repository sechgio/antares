from __future__ import annotations

import threading
import time
from concurrent.futures import CancelledError, Future
from pathlib import Path

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

    def submit_light(self, fn, /, *args, **kwargs):  # type: ignore[no-untyped-def]
        return _ImmediateFuture(fn(*args, **kwargs))


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


def test_conversion_prefetches_next_chunk_while_heavy_runs(monkeypatch) -> None:
    first_heavy_started = threading.Event()
    release_heavy = threading.Event()
    prepare_during_heavy = threading.Event()
    heavy_count = 0
    lock = threading.Lock()

    class _OverlapScheduler:
        def submit_heavy(self, fn, task, *, block=False, cancel_check=None):  # type: ignore[no-untyped-def]
            future: Future = Future()

            def _run() -> None:
                nonlocal heavy_count
                with lock:
                    heavy_count += 1
                    is_first = heavy_count == 1
                if is_first:
                    first_heavy_started.set()
                    release_heavy.wait(timeout=5)
                if not future.cancelled():
                    try:
                        future.set_result(fn(task))
                    except Exception as exc:  # pragma: no cover
                        future.set_exception(exc)

            threading.Thread(target=_run, daemon=True).start()
            return future

        def submit_light(self, fn, /, *args, **kwargs):  # type: ignore[no-untyped-def]
            if first_heavy_started.is_set() and not release_heavy.is_set():
                prepare_during_heavy.set()
            return _ImmediateFuture(fn(*args, **kwargs))

    monkeypatch.setattr(conversion, "get_scheduler", lambda: _OverlapScheduler())
    monkeypatch.setattr(conversion, "es_video", lambda _path: False)
    monkeypatch.setattr(conversion, "convertir_imagen", lambda *args, **kwargs: None)
    monkeypatch.setattr(conversion, "copiar_archivo", lambda *args, **kwargs: Path(args[1]))
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 1)
    monkeypatch.setattr("backend.core.database.buscar_lote_por_codigos", lambda _codes: {})

    job = Job(
        id="prefetch",
        job_type="conversion",
        params={
            "files": ["C:/tmp/a.jpg", "C:/tmp/b.jpg"],
            "destino": "C:/out",
            "formato": "JPEG",
            "usar_rename": True,
            "conversion_enabled": False,
        },
    )

    def _run_job() -> None:
        conversion._run_conversion_job(job)

    thread = threading.Thread(target=_run_job, daemon=True)
    thread.start()
    assert first_heavy_started.wait(timeout=5)
    assert prepare_during_heavy.wait(timeout=2), "expected next-chunk prepare while heavy still running"
    release_heavy.set()
    thread.join(timeout=5)
    assert not thread.is_alive()
    assert job.result is not None
    assert job.result["cancelled"] is False


def test_conversion_cancel_discards_prefetched_chunk(monkeypatch, tmp_path) -> None:
    destino = tmp_path / "out"
    destino.mkdir()
    src_a = tmp_path / "a.jpg"
    src_b = tmp_path / "b.jpg"
    src_a.write_bytes(b"a")
    src_b.write_bytes(b"b")

    first_heavy_started = threading.Event()
    release_heavy = threading.Event()
    written: list[str] = []

    class _CancelScheduler:
        def submit_heavy(self, fn, task, *, block=False, cancel_check=None):  # type: ignore[no-untyped-def]
            future: Future = Future()

            def _run() -> None:
                first_heavy_started.set()
                release_heavy.wait(timeout=5)
                if cancel_check and cancel_check():
                    try:
                        future.set_exception(CancelledError())
                    except Exception:
                        future.cancel()
                    return
                if not future.cancelled():
                    future.set_result(fn(task))

            threading.Thread(target=_run, daemon=True).start()
            return future

        def submit_light(self, fn, /, *args, **kwargs):  # type: ignore[no-untyped-def]
            return _ImmediateFuture(fn(*args, **kwargs))

    def tracking_copy(src, dest):  # type: ignore[no-untyped-def]
        written.append(str(dest))
        Path(dest).write_bytes(b"x")
        return Path(dest)

    monkeypatch.setattr(conversion, "get_scheduler", lambda: _CancelScheduler())
    monkeypatch.setattr(conversion, "es_video", lambda _path: False)
    monkeypatch.setattr(conversion, "copiar_archivo", tracking_copy)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 1)
    monkeypatch.setattr(conversion, "_CANCEL_GRACE_SECONDS", 0.05)
    monkeypatch.setattr("backend.core.database.buscar_lote_por_codigos", lambda _codes: {})

    job = Job(
        id="cancel-prefetch",
        job_type="conversion",
        params={
            "files": [str(src_a), str(src_b)],
            "destino": str(destino),
            "formato": "JPEG",
            "usar_rename": False,
            "conversion_enabled": False,
        },
    )

    def _run_job() -> None:
        conversion._run_conversion_job(job)

    thread = threading.Thread(target=_run_job, daemon=True)
    thread.start()
    assert first_heavy_started.wait(timeout=5)
    with job.state._lock:
        job.state.cancel_requested = True
    release_heavy.set()
    thread.join(timeout=5)
    assert not thread.is_alive()
    assert job.result is not None
    assert job.result["cancelled"] is True
    assert len(written) <= 1
    assert not (destino / "b.jpg").exists()


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

    assert elapsed < 2.5
    assert job.state.running is False
    assert job.result == {"ok_count": 0, "err_count": 0, "cancelled": True}


def test_progress_notifications_throttled_by_interval(monkeypatch, tmp_path) -> None:
    notifies: list[dict] = []

    class _Immediate:
        def submit_heavy(self, fn, task, *, block=False, cancel_check=None):  # type: ignore[no-untyped-def]
            fut = Future()
            fut.set_result(fn(task))
            return fut

        @property
        def heavy_capacity(self) -> int:
            return 4

    monkeypatch.setattr(conversion, "get_scheduler", lambda: _Immediate())
    monkeypatch.setattr(conversion, "es_video", lambda _path: False)
    monkeypatch.setattr(conversion, "copiar_archivo", lambda *_a, **_k: None)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 50)
    monkeypatch.setattr(
        conversion,
        "_emit_progress_notifications",
        lambda _jid, data, _default: notifies.append(dict(data)),
    )
    monkeypatch.setattr(conversion, "_emit_heartbeat", lambda *_a, **_k: None)
    monkeypatch.setattr("backend.core.history.save_run", lambda **_k: None)

    times = iter([1000.0] + [1000.1] * 200)
    monkeypatch.setattr(conversion.time, "time", lambda: next(times, 1000.1))

    n = 50
    dest = tmp_path / "out"
    dest.mkdir()
    job = Job(
        id="throttle",
        job_type="conversion",
        params={
            "files": [str(tmp_path / f"{i}.jpg") for i in range(n)],
            "destino": str(dest),
            "conversion_enabled": False,
            "usar_rename": False,
        },
    )
    with job.state._lock:
        job.state.running = True
        job.state.total = n
    conversion._run_conversion_job(job)

    assert len(notifies) == 2
    assert notifies[0]["progress"] >= 1
    assert notifies[-1]["progress"] == 100


def test_save_run_receives_duration_ms(monkeypatch, tmp_path) -> None:
    captured: dict = {}

    class _Immediate:
        def submit_heavy(self, fn, task, *, block=False, cancel_check=None):  # type: ignore[no-untyped-def]
            fut = Future()
            fut.set_result(fn(task))
            return fut

        @property
        def heavy_capacity(self) -> int:
            return 2

    def fake_save_run(**kwargs):  # type: ignore[no-untyped-def]
        captured.update(kwargs)
        return 1

    monkeypatch.setattr(conversion, "get_scheduler", lambda: _Immediate())
    monkeypatch.setattr(conversion, "es_video", lambda _path: False)
    monkeypatch.setattr(conversion, "copiar_archivo", lambda *_a, **_k: None)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 10)
    monkeypatch.setattr(conversion, "_emit_heartbeat", lambda *_a, **_k: None)
    monkeypatch.setattr(conversion, "send_notification", lambda *_a, **_k: None)
    monkeypatch.setattr("backend.core.history.save_run", fake_save_run)

    dest = tmp_path / "out"
    dest.mkdir()
    job = Job(
        id="dur",
        job_type="conversion",
        params={
            "files": [str(tmp_path / "a.jpg")],
            "destino": str(dest),
            "conversion_enabled": False,
            "usar_rename": False,
        },
    )
    with job.state._lock:
        job.state.running = True
        job.state.total = 1
    conversion._run_conversion_job(job)
    assert "duration_ms" in captured
    assert isinstance(captured["duration_ms"], int)
    assert captured["duration_ms"] >= 0
    """Unexpected exceptions must still emit complete so the UI does not hang."""
    completes: list[tuple[int, int]] = []

    def fake_notify(job, ok, err, **_kwargs):  # type: ignore[no-untyped-def]
        completes.append((ok, err))

    monkeypatch.setattr(conversion, "_notify_complete", fake_notify)
    monkeypatch.setattr(conversion, "es_video", lambda _path: False)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 1)

    def boom(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise RuntimeError("mapping exploded")

    monkeypatch.setattr(
        "backend.core.database.parse_id_rename_mapping",
        boom,
    )

    job = Job(
        id="err",
        job_type="conversion",
        params={
            "files": ["C:/tmp/a.jpg", "C:/tmp/b.jpg"],
            "destino": "C:/out",
            "formato": "JPEG",
            "usar_rename": True,
            "mapping_path": "C:/maps/map.xlsx",
        },
    )
    conversion._run_conversion_job(job)

    assert job.state.running is False
    assert len(completes) == 1
    assert completes[0] == (0, 2)
    assert job.result is not None
    assert job.result["ok_count"] == 0
    assert job.result["err_count"] == 2
    assert job.result["cancelled"] is False
    assert "RuntimeError" in str(job.result.get("error", ""))
