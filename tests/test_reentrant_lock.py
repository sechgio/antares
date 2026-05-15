"""Regression test: ProcessState._lock must be reentrant.

The conversion handler calls log_message(state=state) while already holding
state._lock, which deadlocks if _lock is threading.Lock (non-reentrant).
This test verifies that _lock is RLock and reentrant acquisition works.
"""

import threading

from backend.core.state import ProcessState
from backend.handlers.common import log_message


def test_state_lock_is_reentrant() -> None:
    """Acquiring state._lock twice in the same thread must not deadlock."""
    state = ProcessState()
    with state._lock:
        with state._lock:
            state.progress = 50
    assert state.progress == 50


def test_log_message_inside_lock_does_not_deadlock() -> None:
    """Calling log_message while holding state._lock must not deadlock.

    This is the exact pattern used in handlers/conversion.py:
        with state._lock:
            ...
            log_message("...", state=state)
    """
    state = ProcessState()
    with state._lock:
        log_message("test message", "ok", state=state)
    assert state.logs[0]["message"] == "test message"


def test_nested_lock_from_different_threads() -> None:
    """Multiple threads calling log_message on the same state must not deadlock."""
    state = ProcessState()
    errors = []

    def writer(msg: str) -> None:
        try:
            log_message(msg, "ok", state=state)
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=writer, args=(f"msg-{i}",)) for i in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors
    assert len(state.logs) == 20


def test_process_state_lock_type() -> None:
    """ProcessState._lock must be RLock, not Lock."""
    state = ProcessState()
    assert isinstance(state._lock, type(threading.RLock())), (
        f"ProcessState._lock is {type(state._lock).__name__}, expected RLock"
    )
