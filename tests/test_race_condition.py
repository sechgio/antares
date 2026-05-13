import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import threading

from backend import handlers
from backend.handlers import _state


def test_concurrent_state_access() -> None:
    """Test that concurrent access to ProcessState is safe."""
    results = []

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

if __name__ == "__main__":
    # Reset state before test
    handlers._reset_state()
    test_concurrent_state_access()

