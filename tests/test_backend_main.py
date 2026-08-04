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
    counts = {"warm_core": 0, "warm_deferred": 0, "ready": 0}

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

        def get(self, _method: str):
            return None

    monkeypatch.setattr(backend_main, "HANDLERS", FakeHandlers())

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
    assert counts["ready"] == 1
    assert counts["warm_deferred"] == 0


def test_main_warms_deferred_when_env_enabled(monkeypatch) -> None:
    counts = _run_main_until_eof(monkeypatch, warm_env="1")
    assert counts["warm_core"] == 1
    assert counts["ready"] == 1
    assert counts["warm_deferred"] == 1


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
