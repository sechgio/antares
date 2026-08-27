"""Pruebas del envelope estructurado y la correlación del backend."""

import json
import logging
import re

from backend.core.observability import JsonLogFormatter, build_event, get_context, request_context


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
