from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any

from backend.core.integrations.types import JsonObject


class RunCancelled(Exception):
    pass


_MAX_PROGRESS_CHARS = 64_000


class _CancelEvent:
    def __init__(self) -> None:
        self._event = threading.Event()
        self._progress_lock = threading.Lock()
        self.progress = ""

    def report(self, text: str) -> None:
        with self._progress_lock:
            self.progress = (self.progress + text)[:_MAX_PROGRESS_CHARS]

    def cancel(self) -> None:
        self._event.set()

    def wait(self, timeout: float) -> bool:
        return self._event.wait(timeout)

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()


def await_or_cancel(fn: Callable[[], Any], token: Any, poll_s: float = 0.1) -> Any:
    box: JsonObject = {}

    def target() -> None:
        try:
            box["value"] = fn()
        except BaseException as exc:
            box["error"] = exc

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    while thread.is_alive():
        if token is not None and getattr(token, "cancelled", False):
            raise RunCancelled()
        thread.join(poll_s)
    if "error" in box:
        raise box["error"]
    return box.get("value")
