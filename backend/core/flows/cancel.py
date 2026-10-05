"""Cancelación inmediata de operaciones en curso dentro de un run.

``_await_or_cancel`` corre una llamada bloqueante (HTTP, chat del proveedor) en
un hilo daemon y vuelve en cuanto el token del run se cancela; el hilo queda
huérfano pero su resultado se descarta.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any

from backend.core.flows.types import JsonObject


class RunCancelled(Exception):
    """El run se canceló: la operación en curso se abandona de inmediato."""


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
