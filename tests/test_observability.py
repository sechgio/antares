
import json
import logging
import re
import sys
import threading

import pytest

from backend.core.observability import (
    JsonLogFormatter,
    build_event,
    get_context,
    install_exception_hooks,
    request_context,
)


def test_build_event_contains_context_without_sensitive_fields() -> None:
    with request_context(
        request_id="11111111-1111-4111-8111-111111111111",
        method="canvas_save",
        lane="heavy",
        job_id="job-1",
    ):
        event = build_event(
            "backend.handler.failed",
            logging.ERROR,
            message="Authorization: Bearer secret-value en C:\\Users\\Alice\\doc.json alice@example.com",
            duration_ms=123.4,
            token="must-not-be-serialized",
        )

    assert event["schema_version"] == 1
    assert event["component"] == "backend"
    assert re.fullmatch(r"[0-9a-f-]{36}", event["session_id"], re.IGNORECASE)
    assert event["request_id"] == "11111111-1111-4111-8111-111111111111"
    assert event["method"] == "canvas_save"
    assert event["lane"] == "heavy"
    assert event["job_id"] == "job-1"
    assert event["duration_ms"] == 123
    assert "secret-value" not in event["message"]
    assert "C:\\Users\\Alice\\doc.json" not in event["message"]
    assert "alice@example.com" not in event["message"]
    assert "token" not in event


def test_formatter_emits_single_json_line_with_context() -> None:
    formatter = JsonLogFormatter()
    with request_context(request_id="req-1", method="version", lane="sync"):
        record = logging.LogRecord(
            name="backend.test",
            level=logging.WARNING,
            pathname=__file__,
            lineno=1,
            msg="backend warning",
            args=(),
            exc_info=None,
        )
        payload = json.loads(formatter.format(record))

    assert payload["event"] == "backend.log"
    assert payload["level"] == "WARN"
    assert payload["message"] == "backend warning"
    assert payload["request_id"] == "req-1"
    assert payload["method"] == "version"
    assert payload["lane"] == "sync"
    assert get_context()["request_id"] is None


def test_install_exception_hooks_captures_uncaught_exceptions(monkeypatch: pytest.MonkeyPatch) -> None:
    original_sys_hook = sys.excepthook
    original_thread_hook = getattr(threading, "excepthook", None)

    records: list[logging.LogRecord] = []

    class TestCrashHandler(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record)

    crash_logger = logging.getLogger("backend.crash")
    handler = TestCrashHandler()
    crash_logger.addHandler(handler)

    mock_sys_called = []
    mock_thread_called = []

    monkeypatch.setattr(sys, "excepthook", lambda t, v, tb: mock_sys_called.append((t, v)))
    if hasattr(threading, "excepthook"):
        monkeypatch.setattr(threading, "excepthook", lambda args: mock_thread_called.append(args))

    try:
        install_exception_hooks()

        try:
            raise ValueError("test unhandled crash")
        except ValueError as exc:
            tb = exc.__traceback__
            sys.excepthook(ValueError, exc, tb)

        assert len(records) == 1
        assert records[0].levelno == logging.CRITICAL
        assert getattr(records[0], "observability_event", None) == "backend.crash"
        fields = getattr(records[0], "observability_fields", {})
        assert fields["reason"] == "uncaught_exception"
        assert fields["error_code"] == "ValueError"
        assert fields["outcome"] == "failed"
        assert len(mock_sys_called) == 1

        # KeyboardInterrupt should be forwarded without backend.crash
        sys.excepthook(KeyboardInterrupt, KeyboardInterrupt(), None)
        assert len(records) == 1
        assert len(mock_sys_called) == 2

        # Thread exception
        if hasattr(threading, "excepthook"):

            class DummyThread:
                name = "worker-pool-1"

            try:
                raise RuntimeError("worker failure")
            except RuntimeError as exc:
                t_tb = exc.__traceback__
                thread_args = threading.ExceptHookArgs((RuntimeError, exc, t_tb, DummyThread()))  # type: ignore[arg-type]
                threading.excepthook(thread_args)

            assert len(records) == 2
            assert records[1].levelno == logging.CRITICAL
            assert getattr(records[1], "observability_event", None) == "backend.crash"
            t_fields = getattr(records[1], "observability_fields", {})
            assert t_fields["reason"] == "uncaught_thread_exception"
            assert t_fields["error_code"] == "RuntimeError"
            assert len(mock_thread_called) == 1
    finally:
        crash_logger.removeHandler(handler)
        sys.excepthook = original_sys_hook
        if original_thread_hook is not None:
            threading.excepthook = original_thread_hook


def test_log_message_emits_structured_batch_events() -> None:
    from backend.core.state import ProcessState, log_message

    state = ProcessState()
    records: list[logging.LogRecord] = []

    class TestLogHandler(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record)

    logger = logging.getLogger("backend.handlers.conversion")
    old_level = logger.level
    logger.setLevel(logging.DEBUG)
    handler = TestLogHandler()
    logger.addHandler(handler)
    try:
        with request_context(job_id="job-conv-1", method="process_start", lane="light"):
            log_message("Archivo procesado con éxito", "ok", state=state)
            log_message("Error convirtiendo img.png", "error", state=state)
            log_message("Advertencia de formato", "warn", state=state)

        assert len(records) == 3
        # First log (ok -> INFO, success)
        assert getattr(records[0], "observability_event", None) == "conversion.batch.item"
        assert records[0].levelno == logging.INFO
        assert getattr(records[0], "observability_fields", {}).get("outcome") == "success"

        # Second log (error -> ERROR, failed)
        assert getattr(records[1], "observability_event", None) == "conversion.batch.item"
        assert records[1].levelno == logging.ERROR
        assert getattr(records[1], "observability_fields", {}).get("outcome") == "failed"

        # Third log (warn -> WARNING)
        assert getattr(records[2], "observability_event", None) == "conversion.batch.item"
        assert records[2].levelno == logging.WARNING

        # In-memory target.logs buffer preserved
        assert len(state.logs) == 3
        assert state.logs[0]["message"] == "Advertencia de formato"
        assert state.logs[1]["message"] == "Error convirtiendo img.png"
        assert state.logs[2]["message"] == "Archivo procesado con éxito"
    finally:
        logger.removeHandler(handler)
        logger.setLevel(old_level)


def test_ubicaciones_client_structured_http_logging(monkeypatch: pytest.MonkeyPatch) -> None:
    import urllib.error
    from typing import Any

    from backend.core.ubicaciones.client import _http_get

    records: list[logging.LogRecord] = []

    class TestLogHandler(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record)

    logger = logging.getLogger("backend.core.ubicaciones.client")
    old_level = logger.level
    logger.setLevel(logging.DEBUG)
    handler = TestLogHandler()
    logger.addHandler(handler)
    try:
        # 1. HTTP 503 error
        def mock_urlopen_503(req: Any, timeout: float = 12.0) -> Any:
            raise urllib.error.HTTPError(
                url="https://tile.openstreetmap.org/18/1/1.png",
                code=503,
                msg="Service Unavailable",
                hdrs=None,  # type: ignore[arg-type]
                fp=None,
            )

        monkeypatch.setattr("urllib.request.urlopen", mock_urlopen_503)
        res = _http_get("https://tile.openstreetmap.org/18/1/1.png", headers={}, timeout=1, deadline=None)
        assert res is None
        assert len(records) == 1
        assert getattr(records[0], "observability_event", None) == "ubicaciones.http_error"
        assert records[0].levelno == logging.WARNING
        fields = getattr(records[0], "observability_fields", {})
        assert fields.get("outcome") == "failed"
        assert fields.get("error_code") == "503"

        # 2. Timeout error
        def mock_urlopen_timeout(req: Any, timeout: float = 12.0) -> Any:
            raise TimeoutError("Connection timed out")

        monkeypatch.setattr("urllib.request.urlopen", mock_urlopen_timeout)
        res2 = _http_get("https://tile.openstreetmap.org/18/1/1.png", headers={}, timeout=1, deadline=None)
        assert res2 is None
        assert len(records) == 2
        assert getattr(records[1], "observability_event", None) == "ubicaciones.http_error"
        assert records[1].levelno == logging.WARNING
        assert getattr(records[1], "observability_fields", {}).get("outcome") == "timeout"

        # 3. Deadline exceeded
        monkeypatch.setattr("time.sleep", lambda _: None)
        res3 = _http_get("https://tile.openstreetmap.org/18/1/1.png", headers={}, timeout=1, deadline=0.0)
        assert res3 is None
        assert len(records) == 3
        assert getattr(records[2], "observability_event", None) == "ubicaciones.deadline_exceeded"
        assert records[2].levelno == logging.ERROR
        assert getattr(records[2], "observability_fields", {}).get("outcome") == "timeout"
    finally:
        logger.removeHandler(handler)
        logger.setLevel(old_level)
