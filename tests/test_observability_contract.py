import json
import math
from pathlib import Path

from backend.core.observability import (
    _EVENT_FIELDS,
    _LEVEL_NAMES,
    _OUTCOMES,
    build_event,
    redact_text,
)

_CONTRACT = json.loads(
    (Path(__file__).resolve().parents[1] / "shared" / "observability-contract.json").read_text(
        encoding="utf-8"
    )
)
_CONTRACT_FIELDS = set(_CONTRACT["required_fields"]) | set(_CONTRACT["optional_fields"])


def test_event_fields_are_declared_in_contract() -> None:
    missing = _EVENT_FIELDS - _CONTRACT_FIELDS
    assert not missing, f"campos emitidos fuera del contrato: {sorted(missing)}"


def test_levels_and_outcomes_match_contract() -> None:
    assert set(_CONTRACT["levels"]) == _LEVEL_NAMES
    assert set(_CONTRACT["outcomes"]) == _OUTCOMES


def test_count_and_dropped_events_stay_integers_and_reject_bool() -> None:
    event = build_event(
        "test.evt",
        "INFO",
        fields={"count": 5, "dropped_events": 2, "ok_count": True},
    )
    assert event["count"] == 5
    assert type(event["count"]) is int
    assert event["dropped_events"] == 2
    assert type(event["dropped_events"]) is int
    assert "ok_count" not in event


def test_non_finite_duration_ms_is_dropped_without_crashing() -> None:
    event = build_event("test.evt", "INFO", fields={"duration_ms": math.inf})
    assert "duration_ms" not in event
    event = build_event("test.evt", "INFO", fields={"duration_ms": 12.7})
    assert event["duration_ms"] == 13


def test_redaction_covers_secret_shapes() -> None:
    cases = [
        ("password='abc", "abc"),
        ('password="my secret"', "my secret"),
        ("password='a\"b", 'a"b'),
        ("token=tok-value", "tok-value"),
        ("cookie: sessionid=abc", "sessionid=abc"),
        ("Authorization: Basic QWxhZGRpbjpvcGVu", "QWxhZGRpbjpvcGVu"),
        ("Authorization: Bearer tok123", "tok123"),
        ("Bearer eyJhbGciOiJIUzI1NiJ9", "eyJhbGciOiJIUzI1NiJ9"),
        ("jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dbsig", "eyJzdWIiOiIxIn0"),
        ("error con sk-proj-0123456789abcdefghijklmnopqrstuv", "sk-proj-0123456789abcdefghijklmnopqrstuv"),
        ("error con ghp_0123456789abcdefghijklmnopqrstuvwxyz", "ghp_0123456789abcdefghijklmnopqrstuvwxyz"),
        (
            "error con github_pat_0123456789ABCDEFGHIJ_0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghij",
            "github_pat_0123456789ABCDEFGHIJ_0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghij",
        ),
        ("error con AKIAIOSFODNN7EXAMPLE", "AKIAIOSFODNN7EXAMPLE"),
        (
            "error con xox" "b-123456789012-123456789012-abcdefghijklmnopqrst",
            "xox" "b-123456789012-123456789012-abcdefghijklmnopqrst",
        ),
        ("error con AIza0123456789abcdefghijklmnopqrstuvwxy", "AIza0123456789abcdefghijklmnopqrstuvwxy"),
        ("error con 1//0abcdefghijklmnopqrstuvwxyz123456", "1//0abcdefghijklmnopqrstuvwxyz123456"),
        ("error con ya29.0123456789abcdefghijklmnopqrstuvwxyz", "ya29.0123456789abcdefghijklmnopqrstuvwxyz"),
    ]
    for raw, secret in cases:
        assert secret not in redact_text(raw), raw


def test_redaction_keeps_key_prefix() -> None:
    assert redact_text("password=hunter2") == "password=[REDACTED]"
    assert redact_text("token: abc") == "token: [REDACTED]"
