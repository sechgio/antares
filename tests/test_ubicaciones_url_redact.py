
from __future__ import annotations

from backend.handlers.ubicaciones import _redact_url_for_log


def test_redact_url_strips_key_query_param() -> None:
    url = "https://maps.example/static?center=1,2&key=super-secret-key&zoom=18"
    redacted = _redact_url_for_log(url)
    assert "super-secret-key" not in redacted
    assert "key=%2A%2A%2A" in redacted or "key=***" in redacted


def test_redact_url_strips_access_token() -> None:
    url = "https://api.mapbox.com/tiles/1/2/3?access_token=pk.test.secret"
    redacted = _redact_url_for_log(url)
    assert "pk.test.secret" not in redacted


def test_redact_url_without_query_unchanged() -> None:
    url = "https://tile.openstreetmap.org/1/2/3.png"
    assert _redact_url_for_log(url) == url
