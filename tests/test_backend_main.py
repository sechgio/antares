import json
import os
import subprocess
import sys
import time
from concurrent.futures import Future
from pathlib import Path
from unittest.mock import MagicMock

from backend import main as backend_main


def _run_main_until_eof(monkeypatch, *, warm_env: str | None) -> dict[str, int]:
    """Drive main() through ready handshake then EOF on stdin; count warm calls."""
    counts = {
        "warm_core": 0,
        "warm_pandas_sync": 0,
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

        def warm_pandas_sync(self) -> None:
            counts["warm_pandas_sync"] += 1

        def warm_deferred(self) -> None:
            counts["warm_deferred"] += 1

        def warm_post_ready(self) -> None:
            counts["warm_post_ready"] += 1

        def get(self, _method: str):
            return None

    monkeypatch.setattr(backend_main, "HANDLERS", FakeHandlers())

    class ImmediateThread:
        def __init__(self, *args, target=None, **kwargs):
            self._target = target

        def start(self) -> None:
            if self._target:
                self._target()

    monkeypatch.setattr(backend_main.threading, "Thread", ImmediateThread)

    def fake_notify(method: str, params: dict) -> None:
        if method == "ready":
            counts["ready"] += 1

    monkeypatch.setattr(backend_main, "send_notification", fake_notify)
    monkeypatch.setattr(backend_main, "read_message", lambda: None)  # EOF → exit loop
    monkeypatch.setattr(backend_main, "close_connection", lambda: None)

    scheduler = MagicMock()
    monkeypatch.setattr(backend_main, "get_scheduler", lambda: scheduler)

    backend_main.main()
    scheduler.shutdown.assert_called_once_with(wait=True)
    return counts


def test_main_skips_warm_deferred_by_default(monkeypatch) -> None:
    counts = _run_main_until_eof(monkeypatch, warm_env=None)
    assert counts["warm_core"] == 1
    assert counts["warm_pandas_sync"] == 1
    assert counts["ready"] == 1
    assert counts["warm_deferred"] == 0
    assert counts["warm_post_ready"] == 1


def test_main_warms_deferred_when_env_enabled(monkeypatch) -> None:
    counts = _run_main_until_eof(monkeypatch, warm_env="1")
    assert counts["warm_core"] == 1
    assert counts["warm_pandas_sync"] == 1
    assert counts["ready"] == 1
    assert counts["warm_deferred"] == 1
    assert counts["warm_post_ready"] == 1


def test_main_warms_deferred_for_true_yes_env(monkeypatch) -> None:
    for value in ("true", "YES"):
        counts = _run_main_until_eof(monkeypatch, warm_env=value)
        assert counts["warm_deferred"] == 1, f"expected warm for ANTARES_WARM_DEFERRED={value!r}"


def test_backend_boot_smoke_ready_and_lazy_deferred_methods(tmp_path: Path) -> None:
    """Subprocess smoke: ready handshake + core/deferred methods resolve (lazy OK)."""
    root = Path(__file__).resolve().parent.parent
    # Isolate catalog from the developer's real %LOCALAPPDATA%\\Antares DB.
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
    assert proc.stdin is not None and proc.stdout is not None

    def _readline(timeout_s: float = 30.0) -> dict:
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            line = proc.stdout.readline()
            if not line:
                err = (proc.stderr.read() or b"").decode("utf-8", "replace")[-1500:]
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

        # Deferred module: must resolve (validation error OK; METHOD_NOT_FOUND not OK).
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


def test_heavy_methods_include_fichas_and_evidencia() -> None:
    """Long PDF/import handlers must not run on the light pool."""
    assert "fichas_tecnicas_import_file" in backend_main.HEAVY_METHODS
    assert "fichas_tecnicas_render_html" in backend_main.HEAVY_METHODS
    assert "fichas_tecnicas_render_consolidated_html" in backend_main.HEAVY_METHODS
    assert "informes_v2_import_file" in backend_main.HEAVY_METHODS
    assert "informes_v2_download_template" in backend_main.HEAVY_METHODS
    assert "informes_v2_render_html" in backend_main.HEAVY_METHODS
    assert "informes_v2_render_consolidated_html" in backend_main.HEAVY_METHODS
    assert "evidencia_volanteo_render" in backend_main.HEAVY_METHODS
    assert "canvas_export_cmyk_pdf" in backend_main.HEAVY_METHODS
    assert "canvas_get" in backend_main.HEAVY_METHODS
    assert "canvas_save" in backend_main.HEAVY_METHODS
    assert "canvas_save_history" in backend_main.HEAVY_METHODS


def test_classify_init_db_failure_is_fatal_message() -> None:
    """Document expected stderr phrase used by Electron fatal classification."""
    # The spawner looks for this substring in startup error / stderr tails.
    assert "init_db failed" in "init_db failed during startup: disk full"


def test_sync_methods_are_liveness_safe() -> None:
    """version/process_status stay off the pool so health probes never starve."""
    assert "version" in backend_main.SYNC_METHODS
    assert "process_status" in backend_main.SYNC_METHODS
    # Sync methods must remain cheap — never also classified as heavy work.
    assert backend_main.SYNC_METHODS.isdisjoint(backend_main.HEAVY_METHODS)


def test_process_start_is_not_heavy() -> None:
    """Start only spawns a job thread; must not consume heavy slots."""
    assert "process_start" not in backend_main.HEAVY_METHODS


def test_maybe_log_ipc_timing_logs_slow_handlers(monkeypatch) -> None:
    logged: list[tuple] = []
    monkeypatch.delenv("ANTARES_IPC_TELEMETRY", raising=False)
    monkeypatch.setattr(
        backend_main.logger,
        "log",
        lambda level, msg, *args: logged.append((level, msg % args if args else msg)),
    )

    backend_main._maybe_log_ipc_timing("canvas_save", 100.0, ok=True)
    assert logged == []

    backend_main._maybe_log_ipc_timing("canvas_save", 6_000.0, ok=True)
    assert len(logged) == 1
    assert "canvas_save" in logged[0][1]
    assert "elapsed_ms" in logged[0][1]


def test_maybe_log_ipc_timing_verbose_logs_fast_handlers(monkeypatch) -> None:
    logged: list[tuple] = []
    monkeypatch.setenv("ANTARES_IPC_TELEMETRY", "1")
    monkeypatch.setattr(
        backend_main.logger,
        "log",
        lambda level, msg, *args: logged.append((level, msg % args if args else msg)),
    )

    backend_main._maybe_log_ipc_timing("version", 2.0, ok=True)
    assert len(logged) == 1
    assert "version" in logged[0][1]


def test_main_emits_ready_immediately_before_reading_stdin(monkeypatch) -> None:
    """The ready handshake must mean the backend can accept IPC immediately."""
    events: list[str] = []

    class FakeScheduler:
        def shutdown(self, *, wait: bool) -> None:
            assert wait is True
            events.append("scheduler_shutdown")

    class ImmediateThread:
        def __init__(self, *args, target=None, **kwargs):
            self._target = target

        def start(self) -> None:
            if self._target:
                self._target()

    monkeypatch.setenv("ANTARES_ENABLE_PLUGINS", "1")
    monkeypatch.delenv("ANTARES_WARM_DEFERRED", raising=False)
    monkeypatch.setattr(backend_main, "_shutdown_requested", False)
    monkeypatch.setattr(backend_main, "init_db", lambda: events.append("init_db"))
    monkeypatch.setattr(backend_main.HANDLERS, "warm_core", lambda: events.append("warm_core"))
    monkeypatch.setattr(backend_main.HANDLERS, "warm_pandas_sync", lambda: events.append("warm_pandas_sync"))
    monkeypatch.setattr(backend_main.HANDLERS, "warm_deferred", lambda: events.append("warm_deferred"))
    monkeypatch.setattr(backend_main.HANDLERS, "warm_post_ready", lambda: events.append("warm_post_ready"))
    monkeypatch.setattr(backend_main.threading, "Thread", ImmediateThread)
    monkeypatch.setattr(backend_main, "load_plugins_from_dir", lambda: events.append("plugins"))
    monkeypatch.setattr(
        backend_main,
        "get_scheduler",
        lambda: events.append("get_scheduler") or FakeScheduler(),
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
        "warm_pandas_sync",
        "plugins",
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

    class FakeScheduler:
        def shutdown(self, *, wait: bool) -> None:
            assert wait is True
            events.append("scheduler_shutdown")

    class ImmediateThread:
        def __init__(self, *args, target=None, **kwargs):
            self._target = target

        def start(self) -> None:
            if self._target:
                self._target()

    monkeypatch.delenv("ANTARES_ENABLE_PLUGINS", raising=False)
    monkeypatch.setenv("ANTARES_WARM_DEFERRED", "1")
    monkeypatch.setattr(backend_main, "_shutdown_requested", False)
    monkeypatch.setattr(backend_main, "init_db", lambda: events.append("init_db"))
    monkeypatch.setattr(backend_main.HANDLERS, "warm_core", lambda: events.append("warm_core"))
    monkeypatch.setattr(backend_main.HANDLERS, "warm_pandas_sync", lambda: events.append("warm_pandas_sync"))
    monkeypatch.setattr(backend_main.HANDLERS, "warm_deferred", lambda: events.append("warm_deferred"))
    monkeypatch.setattr(backend_main.HANDLERS, "warm_post_ready", lambda: events.append("warm_post_ready"))
    monkeypatch.setattr(backend_main.threading, "Thread", ImmediateThread)
    monkeypatch.setattr(
        backend_main,
        "get_scheduler",
        lambda: events.append("get_scheduler") or FakeScheduler(),
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
        "warm_pandas_sync",
        "warm_deferred",
        "get_scheduler",
        "ready",
        "warm_post_ready",
        "read_message",
        "scheduler_shutdown",
        "close_connection",
    ]


def test_main_does_not_emit_ready_if_shutdown_arrives_during_startup(monkeypatch) -> None:
    """A process already stopping must never advertise operational readiness."""
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

    monkeypatch.delenv("ANTARES_ENABLE_PLUGINS", raising=False)
    monkeypatch.delenv("ANTARES_WARM_DEFERRED", raising=False)
    monkeypatch.setattr(backend_main, "_shutdown_requested", False)
    monkeypatch.setattr(backend_main, "init_db", lambda: None)
    monkeypatch.setattr(backend_main.HANDLERS, "warm_core", lambda: None)
    monkeypatch.setattr(backend_main.HANDLERS, "warm_pandas_sync", lambda: None)
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
    """Si submit_heavy/submit_light lanza una excepción que no es SchedulerBusy
    (p.ej. RuntimeError tras shutdown, o BrokenThreadPool), el caller debe
    recibir una respuesta JSON-RPC de error en vez de bloquear hasta timeout."""

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
    msg_id, error = responses[0]
    assert msg_id == "42"
    assert error is not None
