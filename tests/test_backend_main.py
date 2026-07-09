import sys
from concurrent.futures import Future

from backend import main as backend_main


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
    assert "evidencia_volanteo_render" in backend_main.HEAVY_METHODS


def test_sync_methods_are_liveness_safe() -> None:
    """version/process_status stay off the pool so health probes never starve."""
    assert "version" in backend_main.SYNC_METHODS
    assert "process_status" in backend_main.SYNC_METHODS
    # Sync methods must remain cheap — never also classified as heavy work.
    assert backend_main.SYNC_METHODS.isdisjoint(backend_main.HEAVY_METHODS)
