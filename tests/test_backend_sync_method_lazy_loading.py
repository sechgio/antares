from __future__ import annotations

from typing import Any

from backend import main as backend_main
from backend.handlers import HANDLERS


def test_sync_method_lazy_loaded_when_not_preloaded(monkeypatch) -> None:
    dispatched: list[tuple[str, Any, str, str]] = []
    responses: list[tuple[Any, str, Any]] = []

    def handler_fn(params: Any) -> dict[str, Any]:
        return {"status": "ok", "echo": params}

    class LazySyncHandlers:
        def __init__(self) -> None:
            self.loaded: dict[str, Any] = {}

        def warm_core(self) -> None:
            pass

        def warm_pandas_sync(self) -> None:
            pass

        def warm_deferred(self) -> None:
            pass

        def warm_post_ready(self) -> None:
            pass

        def get_loaded(self, method: str, default: Any = None) -> Any:
            return self.loaded.get(method, default)

        def get(self, method: str, default: Any = None) -> Any:
            if method == "process_status":
                self.loaded[method] = handler_fn
                return handler_fn
            return default

        def is_known(self, method: str) -> bool:
            return method == "process_status"

    fake_handlers = LazySyncHandlers()
    monkeypatch.setattr(backend_main, "HANDLERS", fake_handlers)
    monkeypatch.setattr(
        backend_main,
        "_dispatch",
        lambda handler, params, msg_id, method: dispatched.append((handler, params, msg_id, method)),
    )
    monkeypatch.setattr(
        backend_main,
        "send_response",
        lambda result, msg_id, *, error=None, **kw: responses.append((result, msg_id, error)),
    )
    monkeypatch.setattr(backend_main, "close_connection", lambda: None)
    monkeypatch.setattr(
        backend_main,
        "read_message",
        iter([
            type("Msg", (), {"method": "process_status", "params": {"job_id": "test-123"}, "id": "req-1"})(),
            None,
        ]).__next__,
    )

    backend_main.main()

    assert len(dispatched) == 1
    handler, params, msg_id, method = dispatched[0]
    assert handler is handler_fn
    assert params == {"job_id": "test-123"}
    assert msg_id == "req-1"
    assert method == "process_status"
    assert not responses


def test_sync_method_not_found_if_get_returns_none(monkeypatch) -> None:
    responses: list[tuple[Any, str, Any]] = []

    class MissingSyncHandlers:
        def warm_core(self) -> None:
            pass

        def warm_pandas_sync(self) -> None:
            pass

        def warm_deferred(self) -> None:
            pass

        def warm_post_ready(self) -> None:
            pass

        def get_loaded(self, method: str, default: Any = None) -> Any:
            return None

        def get(self, method: str, default: Any = None) -> Any:
            return None

        def is_known(self, method: str) -> bool:
            return method == "process_status"

    monkeypatch.setattr(backend_main, "HANDLERS", MissingSyncHandlers())
    monkeypatch.setattr(
        backend_main,
        "send_response",
        lambda result, msg_id, *, error=None, **kw: responses.append((result, msg_id, error)),
    )
    monkeypatch.setattr(backend_main, "close_connection", lambda: None)
    monkeypatch.setattr(
        backend_main,
        "read_message",
        iter([
            type("Msg", (), {"method": "process_status", "params": {}, "id": "req-2"})(),
            None,
        ]).__next__,
    )

    backend_main.main()

    assert len(responses) == 1
    result, msg_id, error = responses[0]
    assert result is None
    assert msg_id == "req-2"
    assert error is not None
    assert "Método desconocido: process_status" in str(error)


def test_process_status_is_sync_and_resolvable_in_real_registry() -> None:
    assert "process_status" in backend_main.SYNC_METHODS
    assert HANDLERS.is_known("process_status")
    handler = HANDLERS.get("process_status")
    assert handler is not None
    assert callable(handler)
