from __future__ import annotations

import urllib.error
from email.message import Message

from backend.handlers import ubicaciones as ub


class _Response:
    def __init__(self, body: bytes) -> None:
        self.body = body

    def __enter__(self) -> _Response:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self) -> bytes:
        return self.body


def _http_error(status: int, retry_after: str | None = None) -> urllib.error.HTTPError:
    headers = Message()
    if retry_after is not None:
        headers['Retry-After'] = retry_after
    return urllib.error.HTTPError('https://tiles.test/tile.png', status, 'failure', headers, None)


def test_http_get_retries_transient_http_errors_and_honors_retry_after(monkeypatch) -> None:
    calls = 0
    sleeps: list[float] = []

    def fake_urlopen(_request, timeout):
        nonlocal calls
        calls += 1
        assert timeout <= 2
        if calls == 1:
            raise _http_error(429, '0')
        return _Response(b'tile')

    monkeypatch.setattr(ub.urllib.request, 'urlopen', fake_urlopen)
    monkeypatch.setattr(ub.time, 'sleep', sleeps.append)

    assert ub._http_get('https://tiles.test/tile.png', {}, timeout=2, deadline=5) == b'tile'
    assert calls == 2
    assert sleeps == [0]


def test_http_get_retries_network_error_until_success(monkeypatch) -> None:
    calls = 0

    def fake_urlopen(_request, timeout):
        nonlocal calls
        calls += 1
        assert timeout <= 2
        if calls == 1:
            raise TimeoutError('timed out')
        return _Response(b'tile')

    monkeypatch.setattr(ub.urllib.request, 'urlopen', fake_urlopen)
    monkeypatch.setattr(ub.time, 'sleep', lambda _seconds: None)

    assert ub._http_get('https://tiles.test/tile.png', {}, timeout=2, deadline=5) == b'tile'
    assert calls == 2


def test_http_get_does_not_retry_non_transient_http_error(monkeypatch) -> None:
    calls = 0

    def fake_urlopen(_request, timeout):
        nonlocal calls
        calls += 1
        raise _http_error(404)

    monkeypatch.setattr(ub.urllib.request, 'urlopen', fake_urlopen)
    monkeypatch.setattr(ub.time, 'sleep', lambda _seconds: None)

    assert ub._http_get('https://tiles.test/missing.png', {}, timeout=2, deadline=5) is None
    assert calls == 1
