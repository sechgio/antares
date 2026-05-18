from concurrent.futures import Future

from backend import main as backend_main


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

    backend_main._submit_handler(lambda _params: {}, {}, "1", "scan_folder")
    backend_main._submit_handler(lambda _params: {}, {}, "2", "version")

    assert calls == [("heavy", "scan_folder"), ("light", "version")]
