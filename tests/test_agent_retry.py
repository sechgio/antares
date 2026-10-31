from __future__ import annotations

import email.message
import urllib.error
from datetime import datetime, timezone
from email.utils import format_datetime

import pytest

from backend.core.agent import agent_chat


def _http_error(code: int, retry_after: str | None = None) -> urllib.error.HTTPError:
    headers = email.message.Message()
    if retry_after is not None:
        headers["Retry-After"] = retry_after
    return urllib.error.HTTPError("https://provider.test/chat", code, "error", headers, None)


class _JsonResponse:
    def __init__(self, payload: bytes) -> None:
        self.headers = email.message.Message()
        self.headers["Content-Type"] = "application/json"
        self._payload = payload

    def __enter__(self) -> _JsonResponse:
        return self

    def __exit__(self, *args: object) -> bool:
        return False

    def read(self, amount: int) -> bytes:
        return self._payload[:amount]


@pytest.mark.parametrize("code", [429, 500, 501, 502, 503, 504, 529, 599])
def test_retryable_statuses_include_429_and_5xx(code: int) -> None:
    assert code in agent_chat._RETRYABLE_HTTP


@pytest.mark.parametrize("code", [400, 401, 404, 408, 600])
def test_non_retryable_statuses_are_not_retried(code: int) -> None:
    assert code not in agent_chat._RETRYABLE_HTTP


def test_retry_after_seconds_are_respected_without_jitter(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(agent_chat.random, "uniform", lambda *_: pytest.fail("Retry-After no usa jitter"))
    assert agent_chat._retry_delay_s(_http_error(429, "2"), 1) == 2.0
    assert agent_chat._retry_delay_s(_http_error(503, "45"), 0) == agent_chat._RETRY_AFTER_CAP_S


def test_retry_after_http_date_uses_simulated_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime(2026, 10, 31, 12, 0, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(agent_chat.time, "time", lambda: now.timestamp())
    retry_after = format_datetime(now.replace(second=10), usegmt=True)
    assert agent_chat._retry_delay_s(_http_error(429, retry_after), 0) == 10.0


def test_invalid_retry_after_falls_back_to_exponential_jitter(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(agent_chat.random, "uniform", lambda _low, high: high)
    assert agent_chat._retry_delay_s(_http_error(503, "soon"), 0) == 1.25
    assert agent_chat._retry_delay_s(_http_error(503), 1) == 5.0


def test_negative_retry_after_waits_zero() -> None:
    assert agent_chat._retry_delay_s(_http_error(429, "-1"), 0) == 0.0


def test_post_json_honors_retry_after_with_simulated_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts = iter([_http_error(429, "7"), _http_error(503, "45"), _JsonResponse(b'{"ok": true}')])
    delays: list[float] = []

    def open_once(*_args: object, **_kwargs: object) -> _JsonResponse:
        result = next(attempts)
        if isinstance(result, urllib.error.HTTPError):
            raise result
        return result

    monkeypatch.setattr(agent_chat.http_guard.no_redirect_opener, "open", open_once)
    monkeypatch.setattr(agent_chat.time, "sleep", delays.append)

    assert agent_chat._post_json("https://provider.test/chat", {}, {"model": "test"}) == {"ok": True}
    assert delays == [7.0, agent_chat._RETRY_AFTER_CAP_S]


def test_post_json_retries_5xx_with_simulated_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts = iter([_http_error(503), _http_error(504), _JsonResponse(b'{"ok": true}')])
    delays: list[float] = []

    def open_once(*_args: object, **_kwargs: object) -> _JsonResponse:
        result = next(attempts)
        if isinstance(result, urllib.error.HTTPError):
            raise result
        return result

    monkeypatch.setattr(agent_chat.http_guard.no_redirect_opener, "open", open_once)
    monkeypatch.setattr(agent_chat.time, "sleep", delays.append)
    monkeypatch.setattr(agent_chat.random, "uniform", lambda _low, high: high)

    assert agent_chat._post_json("https://provider.test/chat", {}, {"model": "test"}) == {"ok": True}
    assert delays == [1.25, 5.0]
