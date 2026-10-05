"""Disparadores ``app_event``: bus interno de eventos de la aplicación.

Los emisores llaman a :func:`emit`; el dispatcher arranca los flujos activos
cuyo trigger ``app_event`` coincide con el nombre del evento (o va sin filtro).
Un guarda de profundidad por hilo evita cadenas infinitas (p. ej. un flujo que
escucha ``flow_finished`` y dispara otro flujo que lo vuelve a emitir).
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from typing import Any

from backend.core.flows.types import JsonObject

logger = logging.getLogger(__name__)

APP_EVENTS: list[JsonObject] = [
    {"id": "app_started", "label": "Al abrir la aplicación"},
    {"id": "job_finished", "label": "Al terminar una conversión o proceso"},
    {"id": "flow_finished", "label": "Al terminar la ejecución de un flujo"},
]

_MAX_EMIT_DEPTH = 8
_dispatch: Callable[[str, JsonObject], None] | None = None
_local = threading.local()


def set_dispatcher(fn: Callable[[str, JsonObject], None] | None) -> None:
    global _dispatch
    _dispatch = fn


def make_dispatcher(store: Any, runner: Any) -> Callable[[str, JsonObject], None]:
    """Construye el dispatcher: evento → arranque de flujos coincidentes."""

    def dispatch(event: str, data: JsonObject) -> None:
        # Cada ejecución hereda el linaje del evento; un flujo ya presente en la
        # cadena no se vuelve a disparar (p. ej. un trigger flow_finished sobre
        # el propio flujo, o ciclos A→B→A repartidos en hilos distintos).
        chain = [str(f) for f in (data.get("__event_chain") or [])]
        clean = {k: v for k, v in data.items() if k != "__event_chain"}
        for meta in store.list_flows():
            if not meta.get("enabled"):
                continue
            flow = store.get(str(meta["id"]))
            if flow is None:
                continue
            trigger = next(
                (n for n in flow["graph"]["nodes"] if n.get("kind") == "trigger"), None
            )
            config = (trigger or {}).get("config") or {}
            if config.get("trigger_kind") != "app_event":
                continue
            wanted = str(config.get("event") or "").strip()
            if wanted and wanted != event:
                continue
            if str(flow["id"]) in chain:
                continue
            payload: JsonObject = {"source": "app_event", "event": event, "data": clean}
            if chain:
                payload["__event_chain"] = chain
            try:
                runner.start(flow["id"], payload)
            except Exception:
                logger.exception("No se pudo disparar el flujo %s por el evento %s", flow["id"], event)

    return dispatch


def emit(event: str, data: JsonObject | None = None) -> None:
    """Emite un evento interno. Nunca propaga errores a quien lo lanza."""
    if _dispatch is None:
        return
    depth = getattr(_local, "depth", 0)
    if depth >= _MAX_EMIT_DEPTH:
        logger.warning("Se superó la profundidad máxima de eventos; se descarta %s", event)
        return
    _local.depth = depth + 1
    try:
        _dispatch(event, dict(data or {}))
    except Exception:
        logger.exception("El dispatcher de eventos falló para %s", event)
    finally:
        _local.depth = depth
