"""Cancelación inmediata de operaciones en curso dentro de un run.

``_await_or_cancel`` corre una llamada bloqueante (HTTP, chat del proveedor) en
un hilo daemon y vuelve en cuanto el token del run se cancela; el hilo queda
huérfano pero su resultado se descarta.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any

from backend.core.integrations.types import JsonObject


class RunCancelled(Exception):
    """El run se canceló: la operación en curso se abandona de inmediato."""


class _CancelEvent:
    def __init__(self) -> None:
        self._event = threading.Event()

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
        except BaseException as exc:  # se re-lanza abajo
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
