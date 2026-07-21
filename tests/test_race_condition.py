"""Verify that concurrent access to ProcessState is thread-safe."""

from __future__ import annotations

import threading

from backend.handlers import _state


def test_concurrent_state_access() -> None:
    """Concurrent reads and writes to ProcessState must not lose data."""
    results: list[bool] = []

    def reader() -> None:
        for _ in range(100):
            with _state._lock:
                results.append(_state.running)

    def writer() -> None:
        for i in range(100):
            with _state._lock:
                _state.progress = i

    threads = [threading.Thread(target=reader) for _ in range(5)] + \
              [threading.Thread(target=writer) for _ in range(5)]

    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(results) == 500
