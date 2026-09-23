import json
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import Future
from pathlib import Path
from unittest.mock import MagicMock

from backend import main as backend_main


class _ImmediateThread:
    def __init__(self, *args, target=None, **kwargs):
        self._target = target

    def start(self) -> None:
        if self._target:
            self._target()

    def is_alive(self) -> bool:
        return False

    def join(self, timeout: float | None = None) -> None:
        return None


class _ShutdownRecorderScheduler:
    def __init__(self, events: list[str]) -> None:
        self._events = events

    def shutdown(self, *, wait: bool) -> None:
        assert wait is True
        self._events.append("scheduler_shutdown")


def _run_main_until_eof(monkeypatch, *, warm_env: str | None) -> dict[str, int]:
    counts = {
        "warm_core": 0,
        "warm_deferred": 0,
        "warm_post_ready": 0,
        "ready": 0,
    }

    if warm_env is None:
        monkeypatch.delenv("ANTARES_WARM_DEFERRED", raising=False)
    else:
        monkeypatch.setenv("ANTARES_WARM_DEFERRED", warm_env)

    monkeypatch.setattr(backend_main, "init_db", lambda: None)

    class FakeHandlers:
        def warm_core(self) -> None:
            counts["warm_core"] += 1

        def warm_deferred(self) -> None:
            counts["warm_deferred"] += 1

        def warm_post_ready(self) -> None:
            counts["warm_post_ready"] += 1

        def get(self, _method: str):
            return None

        def get_loaded(self, _method: str, default=None):
            return default

        def is_known(self, _method: str) -> bool:
            return False

    monkeypatch.setattr(backend_main, "HANDLERS", FakeHandlers())

    monkeypatch.setattr(backend_main.threading, "Thread", _ImmediateThread)

    def fake_notify(method: str, params: dict) -> None:
        if method == "ready":
            counts["ready"] += 1

    monkeypatch.setattr(backend_main, "send_notification", fake_notify)
    monkeypatch.setattr(backend_main, "read_message", lambda: None)
    monkeypatch.setattr(backend_main, "close_connection", lambda: None)

    scheduler = MagicMock()
    monkeypatch.setattr(backend_main, "get_scheduler", lambda: scheduler)

    backend_main.main()
    scheduler.shutdown.assert_called_once_with(wait=True)
    return counts


def test_main_skips_warm_deferred_by_default(monkeypatch) -> None:
    counts = _run_main_until_eof(monkeypatch, warm_env=None)
    assert counts["warm_core"] == 1
    assert counts["ready"] == 1
    assert counts["warm_deferred"] == 0
    assert counts["warm_post_ready"] == 1


def test_main_warms_deferred_when_env_enabled(monkeypatch) -> None:
    counts = _run_main_until_eof(monkeypatch, warm_env="1")
    assert counts["warm_core"] == 1
    assert counts["ready"] == 1
    assert counts["warm_deferred"] == 1
    assert counts["warm_post_ready"] == 1


def test_main_warms_deferred_for_true_yes_env(monkeypatch) -> None:
    for value in ("true", "YES"):
        counts = _run_main_until_eof(monkeypatch, warm_env=value)
        assert counts["warm_deferred"] == 1, f"expected warm for ANTARES_WARM_DEFERRED={value!r}"


def test_backend_boot_smoke_ready_and_lazy_deferred_methods(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parent.parent
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["LOCALAPPDATA"] = str(tmp_path)
    env["XDG_DATA_HOME"] = str(tmp_path / "xdg")
    env.pop("ANTARES_WARM_DEFERRED", None)

    proc = subprocess.Popen(
        [sys.executable, str(root / "backend" / "main.py")],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(root),
        env=env,
    )
    assert proc.stdin is not None and proc.stdout is not None and proc.stderr is not None

    stderr_lines: list[str] = []

    def _drain_stderr() -> None:
        assert proc.stderr is not None
        for err_line in iter(proc.stderr.readline, b""):
            stderr_lines.append(err_line.decode("utf-8", "replace"))

    drainer = threading.Thread(target=_drain_stderr, daemon=True)
    drainer.start()

    def _readline(timeout_s: float = 30.0) -> dict:
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            line = proc.stdout.readline()
            if not line:
                err = "".join(stderr_lines[-20:])
                raise AssertionError(f"stdout EOF before message; stderr tail:\n{err}")
            return json.loads(line.decode("utf-8"))
        raise AssertionError("timeout waiting for backend line")

    try:
        ready = None
        deadline = time.time() + 30
        while time.time() < deadline:
            msg = _readline(timeout_s=max(1.0, deadline - time.time()))
            if msg.get("method") == "ready":
                ready = msg
                break
        assert ready is not None, "backend did not emit ready"
        assert ready.get("params", {}).get("status") == "ok"

        def rpc(method: str, mid: int, params: dict | None = None) -> dict:
            req = {"jsonrpc": "2.0", "id": mid, "method": method, "params": params or {}}
            proc.stdin.write((json.dumps(req) + "\n").encode("utf-8"))
            proc.stdin.flush()
            deadline_rpc = time.time() + 20
            while time.time() < deadline_rpc:
                msg = _readline(timeout_s=max(1.0, deadline_rpc - time.time()))
                if msg.get("id") == mid:
                    return msg
            raise AssertionError(f"timeout waiting for response id={mid} ({method})")

        version = rpc("version", 1)
        assert "result" in version and "error" not in version

        canvas = rpc("canvas_list", 2)
        assert canvas.get("error", {}).get("code") != -32601, canvas

        sellador = rpc("sellador_apply", 3, {})
        assert sellador.get("error", {}).get("code") != -32601, sellador
        assert "error" in sellador or "result" in sellador

        formatos = rpc("formatos_list", 4)
        assert formatos.get("error", {}).get("code") != -32601, formatos
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


def test_utf8_locale_candidates_on_windows_exclude_bare_es_mx(monkeypatch) -> None:
    monkeypatch.setattr(sys, "platform", "win32")
    candidates = backend_main._utf8_locale_candidates()
    assert "es-MX" not in candidates
    assert "es-MX.UTF-8" in candidates
    assert "Spanish_Mexico.UTF-8" in candidates


def test_future_callback_logs_unhandled_handler_errors(monkeypatch) -> None:
    logged = []
    monkeypatch.setattr(backend_main.logger, "exception", lambda *args: logged.append(args))

    future = Future()
    future.set_exception(RuntimeError("boom"))

    backend_main._log_future_exception(future)

    assert logged
    assert "Handler raised" in logged[0][0]


def test_dispatch_uses_heavy_scheduler_for_heavy_methods(monkeypatch) -> None:
    calls = []

    class FakeScheduler:
        def submit_heavy(self, fn, *args, **kwargs):  # type: ignore[no-untyped-def]
            calls.append(("heavy", args[3]))
            future = Future()
            future.set_result(None)
            return future

        def submit_light(self, fn, *args, **kwargs):  # type: ignore[no-untyped-def]
            calls.append(("light", args[3]))
            future = Future()
            future.set_result(None)
            return future

    monkeypatch.setattr(backend_main, "get_scheduler", lambda: FakeScheduler())
    monkeypatch.setattr(backend_main, "_dispatch", lambda *args: None)

    backend_main._submit_handler(lambda _params: {}, {}, "1", "db_import")
    backend_main._submit_handler(lambda _params: {}, {}, "2", "version")
    backend_main._submit_handler(lambda _params: {}, {}, "3", "fichas_tecnicas_render_html")
    backend_main._submit_handler(lambda _params: {}, {}, "4", "evidencia_volanteo_render")

    assert calls == [
        ("heavy", "db_import"),
        ("light", "version"),
        ("heavy", "fichas_tecnicas_render_html"),
        ("heavy", "evidencia_volanteo_render"),
    ]


def test_maybe_log_ipc_timing_logs_slow_handlers(monkeypatch) -> None:
    import logging as _logging

    logged: list[tuple] = []
    monkeypatch.delenv("ANTARES_IPC_TELEMETRY", raising=False)
    monkeypatch.setattr(
        backend_main,
        "log_event",
        lambda _logger, level, event, **fields: logged.append((level, event, fields)),
    )

    backend_main._maybe_log_ipc_timing("canvas_save", 100.0, ok=True)
    assert logged == []

    backend_main._maybe_log_ipc_timing("canvas_save", 6_000.0, ok=True)
    assert len(logged) == 1
    level, event, fields = logged[0]
    assert level == _logging.WARNING
    assert event == "backend.ipc.timing"
    assert fields["method"] == "canvas_save"
    assert fields["duration_ms"] == 6000
    assert fields["outcome"] == "success"
    assert fields["reason"] == "slow"
    assert "elapsed_ms" in fields["message"]


def test_maybe_log_ipc_timing_verbose_logs_fast_handlers(monkeypatch) -> None:
    logged: list[tuple] = []
    monkeypatch.setenv("ANTARES_IPC_TELEMETRY", "1")
    monkeypatch.setattr(
        backend_main,
        "log_event",
        lambda _logger, level, event, **fields: logged.append((level, event, fields)),
    )

    backend_main._maybe_log_ipc_timing("version", 2.0, ok=True)
    assert len(logged) == 1
    _level, event, fields = logged[0]
    assert event == "backend.ipc.timing"
    assert fields["method"] == "version"
    assert fields["duration_ms"] == 2
    assert fields["outcome"] == "success"
    assert "reason" not in fields


def test_maybe_log_ipc_timing_samples_successes_and_keeps_fast_failures(monkeypatch) -> None:
    import logging as _logging

    logged: list[tuple] = []
    monkeypatch.delenv("ANTARES_IPC_TELEMETRY", raising=False)
    monkeypatch.setattr(
        backend_main,
        "log_event",
        lambda _logger, level, event, **fields: logged.append((level, event, fields)),
    )
    monkeypatch.setattr(backend_main.zlib, "crc32", lambda _value: 0)

    backend_main._maybe_log_ipc_timing("version", 2.0, ok=True, request_id="sampled-request")
    assert len(logged) == 1
    assert logged[0][1] == "backend.ipc.timing"

    logged.clear()
    monkeypatch.setattr(backend_main.zlib, "crc32", lambda _value: 1)
    backend_main._maybe_log_ipc_timing("version", 2.0, ok=True, request_id="unsampled-request")
    assert logged == []

    backend_main._maybe_log_ipc_timing("version", 2.0, ok=False, request_id="failed-request")
    assert len(logged) == 1
    assert logged[0][0] == _logging.WARNING
    assert logged[0][2]["outcome"] == "failed"


def test_heartbeat_loop_emits_backend_heartbeat(monkeypatch) -> None:
    logged: list[tuple] = []
    monkeypatch.setattr(
        backend_main,
        "log_event",
        lambda _logger, level, event, **fields: logged.append((level, event, fields)),
    )
    monkeypatch.setattr(backend_main, "_heartbeat_interval_s", lambda: 0.01)
    monkeypatch.setattr(backend_main, "_heartbeat_process_snapshot", lambda: (12345, 7))

    class FakeScheduler:
        def metrics(self) -> dict:
            return {
                "light_active": 1,
                "light_queued": 0,
                "heavy_active": 0,
                "heavy_queued": 2,
                "light_rejected": 0,
                "heavy_rejected": 1,
                "memory_pressure": True,
                "system_ram_available_mb": 512,
            }

    stop = threading.Event()
    thread = threading.Thread(
        target=backend_main._heartbeat_loop, args=(stop, FakeScheduler()), daemon=True
    )
    thread.start()
    time.sleep(0.05)
    stop.set()
    thread.join(timeout=2)

    assert logged, "heartbeat debe emitir backend.heartbeat"
    import logging as _logging

    level, event, fields = logged[0]
    assert event == "backend.heartbeat"
    assert level == _logging.WARNING
    assert fields["bytes"] == 12345
    assert fields["count"] == 7
    assert fields["reason"] == "memory_pressure"
    compact = json.loads(fields["message"])
    assert compact["memory_pressure"] is True
    assert compact["heavy_queued"] == 2


def test_main_emits_ready_immediately_before_reading_stdin(monkeypatch) -> None:
    events: list[str] = []

    monkeypatch.delenv("ANTARES_WARM_DEFERRED", raising=False)
    monkeypatch.setattr(backend_main, "_shutdown_requested", False)
    monkeypatch.setattr(backend_main, "init_db", lambda: events.append("init_db"))
    monkeypatch.setattr(backend_main.HANDLERS, "warm_core", lambda: events.append("warm_core"))
    monkeypatch.setattr(backend_main.HANDLERS, "warm_deferred", lambda: events.append("warm_deferred"))
    monkeypatch.setattr(backend_main.HANDLERS, "warm_post_ready", lambda: events.append("warm_post_ready"))
    monkeypatch.setattr(backend_main.threading, "Thread", _ImmediateThread)
    monkeypatch.setattr(
        backend_main,
        "get_scheduler",
        lambda: events.append("get_scheduler") or _ShutdownRecorderScheduler(events),
    )
    monkeypatch.setattr(
        backend_main,
        "send_notification",
        lambda method, _params: events.append(method),
    )
    monkeypatch.setattr(
        backend_main,
        "read_message",
        lambda: events.append("read_message") or None,
    )
    monkeypatch.setattr(
        backend_main,
        "close_connection",
        lambda: events.append("close_connection"),
    )

    backend_main.main()

    assert events == [
        "init_db",
        "warm_core",
        "get_scheduler",
        "ready",
        "warm_post_ready",
        "read_message",
        "scheduler_shutdown",
        "close_connection",
    ]
    assert "warm_deferred" not in events


def test_main_emits_ready_after_opt_in_warm_deferred(monkeypatch) -> None:
    events: list[str] = []

    monkeypatch.setenv("ANTARES_WARM_DEFERRED", "1")
    monkeypatch.setattr(backend_main, "_shutdown_requested", False)
    monkeypatch.setattr(backend_main, "init_db", lambda: events.append("init_db"))
    monkeypatch.setattr(backend_main.HANDLERS, "warm_core", lambda: events.append("warm_core"))
    monkeypatch.setattr(backend_main.HANDLERS, "warm_deferred", lambda: events.append("warm_deferred"))
    monkeypatch.setattr(backend_main.HANDLERS, "warm_post_ready", lambda: events.append("warm_post_ready"))
    monkeypatch.setattr(backend_main.threading, "Thread", _ImmediateThread)
    monkeypatch.setattr(
        backend_main,
        "get_scheduler",
        lambda: events.append("get_scheduler") or _ShutdownRecorderScheduler(events),
    )
    monkeypatch.setattr(
        backend_main,
        "send_notification",
        lambda method, _params: events.append(method),
    )
    monkeypatch.setattr(
        backend_main,
        "read_message",
        lambda: events.append("read_message") or None,
    )
    monkeypatch.setattr(
        backend_main,
        "close_connection",
        lambda: events.append("close_connection"),
    )

    backend_main.main()

    assert events == [
        "init_db",
        "warm_core",
        "warm_deferred",
        "get_scheduler",
        "ready",
        "warm_post_ready",
        "read_message",
        "scheduler_shutdown",
        "close_connection",
    ]


def test_main_does_not_emit_ready_if_shutdown_arrives_during_startup(monkeypatch) -> None:
    notifications: list[str] = []

    class FakeScheduler:
        def __init__(self) -> None:
            backend_main._shutdown_requested = True

        def shutdown(self, *, wait: bool) -> None:
            assert wait is True

    def fail_if_read() -> None:
        raise AssertionError("stdin must not be read after startup shutdown")

    def fail_if_post_ready() -> None:
        raise AssertionError("post-ready warm must not run when ready is skipped")

    monkeypatch.delenv("ANTARES_WARM_DEFERRED", raising=False)
    monkeypatch.setattr(backend_main, "_shutdown_requested", False)
    monkeypatch.setattr(backend_main, "init_db", lambda: None)
    monkeypatch.setattr(backend_main.HANDLERS, "warm_core", lambda: None)
    monkeypatch.setattr(backend_main.HANDLERS, "warm_deferred", lambda: None)
    monkeypatch.setattr(backend_main.HANDLERS, "warm_post_ready", fail_if_post_ready)
    monkeypatch.setattr(backend_main, "get_scheduler", FakeScheduler)
    monkeypatch.setattr(
        backend_main,
        "send_notification",
        lambda method, _params: notifications.append(method),
    )
    monkeypatch.setattr(backend_main, "read_message", fail_if_read)
    monkeypatch.setattr(backend_main, "close_connection", lambda: None)

    backend_main.main()

    assert notifications == ["backend.shutdown"]


def test_submit_handler_sends_response_when_scheduler_submit_raises(monkeypatch) -> None:

    class BrokenScheduler:
        def submit_heavy(self, fn, *args, **kwargs):  # type: ignore[no-untyped-def]
            raise RuntimeError("cannot schedule new futures after shutdown")

        def submit_light(self, fn, *args, **kwargs):  # type: ignore[no-untyped-def]
            raise RuntimeError("cannot schedule new futures after shutdown")

        def metrics(self) -> dict:
            return {}

    responses: list[tuple] = []
    monkeypatch.setattr(backend_main, "get_scheduler", lambda: BrokenScheduler())
    monkeypatch.setattr(
        backend_main,
        "send_response",
        lambda result, msg_id, *, error=None, **kw: responses.append((msg_id, error)),
    )

    result = backend_main._submit_handler(lambda _p: {}, {}, "42", "db_import")

    assert result is None
    assert len(responses) == 1, "caller must receive a JSON-RPC error response"
    msg_id, _error = responses[0]
    assert msg_id == "42"


def test_submit_handler_rejects_unexpected_memory_guard_failure(monkeypatch) -> None:
    from backend.handlers import canvas as canvas_handlers

    class FakeScheduler:
        def metrics(self) -> dict:
            return {}

    responses: list[tuple] = []
    monkeypatch.setattr(backend_main, "get_scheduler", lambda: FakeScheduler())

    def fail_memory_check(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("spill guard unavailable")

    monkeypatch.setattr(backend_main, "is_memory_pressure", lambda: True)
    monkeypatch.setattr(
        canvas_handlers,
        "_check_memory_pressure_or_spill",
        fail_memory_check,
    )
    monkeypatch.setattr(
        backend_main,
        "send_response",
        lambda result, msg_id, *, error=None, **kw: responses.append((msg_id, error)),
    )

    result = backend_main._submit_handler(
        lambda _params: {},
        {"document": {"id": "large-doc"}},
        "43",
        "canvas_save",
    )

    assert result is None
    assert responses == [("43", "Backend no disponible: no se pudo comprobar la presión de memoria")]


def test_main_resolves_deferred_method_in_worker_not_reader(monkeypatch) -> None:

    loaded: dict[str, object] = {}
    reads: list[str] = []

    class DeferredHandlers:
        def warm_core(self) -> None:
            pass

        def warm_deferred(self) -> None:
            pass

        def warm_post_ready(self) -> None:
            pass

        def get(self, method: str, default=None):
            reads.append(method)
            return loaded.get(method, default)

        def get_loaded(self, method: str, default=None):
            return loaded.get(method, default)

        def is_known(self, method: str) -> bool:
            return method == "generar_ubicaciones"

    calls: list[tuple] = []

    class FakeScheduler:
        def submit_light(self, fn, *args, **kwargs):
            calls.append(("light", args))
            return None

        def submit_heavy(self, fn, *args, **kwargs):
            calls.append(("heavy", args))
            return None

        def metrics(self) -> dict:
            return {}

        def shutdown(self, wait=True):
            pass

    monkeypatch.setattr(backend_main, "HANDLERS", DeferredHandlers())
    monkeypatch.setattr(backend_main, "get_scheduler", lambda: FakeScheduler())
    monkeypatch.setattr(backend_main, "WARM_CRITICAL_DONE", type("Ev", (), {"wait": lambda self, timeout=None: True})())
    monkeypatch.setattr(backend_main, "read_message", iter([type("M", (), {"method": "generar_ubicaciones", "params": {}, "id": "d1"})(), None]).__next__)
    monkeypatch.setattr(backend_main, "send_response", lambda *a, **k: None)
    monkeypatch.setattr(backend_main, "close_connection", lambda: None)

    backend_main.main()

    assert calls, "método deferred debe enviarse al scheduler (worker)"
    assert calls[0][0] == "heavy" or calls[0][0] == "light", "deferred va a una lane"
    assert reads == [], "el reader no debe importar módulos deferred"


def test_main_unknown_method_rejected_without_import(monkeypatch) -> None:

    class StrictHandlers:
        def warm_core(self) -> None:
            pass

        def warm_deferred(self) -> None:
            pass

        def warm_post_ready(self) -> None:
            pass

        def get(self, method: str, default=None):
            raise AssertionError("get() no debe llamarse para métodos desconocidos")

        def get_loaded(self, method: str, default=None):
            return default

        def is_known(self, method: str) -> bool:
            return False

    responses: list[tuple] = []
    monkeypatch.setattr(backend_main, "HANDLERS", StrictHandlers())
    monkeypatch.setattr(
        backend_main,
        "read_message",
        iter([type("M", (), {"method": "no_existe", "params": {}, "id": "u1"})(), None]).__next__,
    )
    monkeypatch.setattr(
        backend_main,
        "send_response",
        lambda result, msg_id, *, error=None, **kw: responses.append((msg_id, error)),
    )
    monkeypatch.setattr(backend_main, "close_connection", lambda: None)

    backend_main.main()

    assert len(responses) == 1
    assert "Método desconocido" in str(responses[0][1])
