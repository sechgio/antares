from __future__ import annotations

import logging

import pytest

from backend.handlers.telemetry import telemetry


def test_telemetry_logs_one_sanitized_record_without_url(caplog, capsys) -> None:
    params = {
        "name": "LCP",
        "value": 123.5,
        "rating": "good",
        "id": "v4-1234567890123-1234567890123",
        "navigationType": "navigate",
        "url": "https://example.test/?token=secret#private",
    }

    with caplog.at_level(logging.INFO, logger="backend.handlers.telemetry"):
        result = telemetry(params)

    assert result == {"ok": True}
    records = [record for record in caplog.records if record.name == "backend.handlers.telemetry"]
    assert len(records) == 1
    assert records[0].message == "rum metric=LCP value=123.5000 rating=good id=v4-1234567890123-1234567890123 nav=navigate"
    assert "secret" not in records[0].message
    assert "url=" not in records[0].message
    assert capsys.readouterr().err == ""


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -1, "123", True])
def test_telemetry_rejects_invalid_metric_values(value, caplog) -> None:
    with caplog.at_level(logging.INFO, logger="backend.handlers.telemetry"):
        result = telemetry({"name": "CLS", "value": value})

    assert result == {"ok": False}
    assert not caplog.records


def test_telemetry_normalizes_untrusted_dimensions(caplog) -> None:
    with caplog.at_level(logging.INFO, logger="backend.handlers.telemetry"):
        result = telemetry(
            {
                "name": "lcp",
                "value": 1,
                "rating": "unexpected\nvalue",
                "id": "id=with spaces\n",
                "navigationType": "unexpected",
            }
        )

    assert result == {"ok": True}
    assert caplog.records[0].message == "rum metric=LCP value=1.0000 rating=unknown id=- nav=unknown"
