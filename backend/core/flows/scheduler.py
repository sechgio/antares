"""Planificador de flujos: dispara runs para triggers ``schedule`` mientras la
app está abierta. Recorre los flujos habilitados y ejecuta los que ya tocan.

El plan funciona mientras el backend está vivo: al cerrar la app no hay
ejecuciones diferidas ni reanudación (limitación documentada).
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from backend.core.flows.schema import normalize_graph
from backend.core.flows.store import FlowStore, _utc_now
from backend.core.flows.types import JsonObject

if TYPE_CHECKING:
    from backend.core.flows.runner import FlowRunner

logger = logging.getLogger(__name__)

TICK_SECONDS = 15.0


def _schedule_interval_minutes(flow: JsonObject) -> int | None:
    """Minutos del intervalo si el flujo tiene trigger schedule; None si no."""
    try:
        graph = normalize_graph(flow.get("graph") or {})
    except ValueError:
        return None
    for node in graph["nodes"]:
        if node["kind"] == "trigger" and node["config"].get("trigger_kind") == "schedule":
            interval = node["config"].get("interval_minutes", 60)
            try:
                value = int(interval)
            except (TypeError, ValueError):
                return None
            return value if 1 <= value <= 10080 else None
    return None


class FlowScheduler:
    """Hilo daemon que dispara ``flows_run`` para flujos programados."""

    def __init__(
        self,
        store: FlowStore,
        runner: FlowRunner,
        *,
        tick_seconds: float = TICK_SECONDS,
        clock: Callable[[], str] = _utc_now,
    ) -> None:
        self._store = store
        self._runner = runner
        self._tick_seconds = tick_seconds
        self._clock = clock
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(
            target=self._loop,
            name="flow-scheduler",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.wait(self._tick_seconds):
            try:
                self.tick()
            except Exception:
                logger.exception("Fallo en tick del planificador de flujos")

    def due_flows(self, now: str) -> list[JsonObject]:
        """Flujos habilitados con trigger schedule cuya hora ya pasó."""
        due: list[JsonObject] = []
        for meta in self._store.list_flows():
            # list_flows devuelve metas sin graph; el trigger vive en el doc completo.
            flow = self._store.get(meta["id"])
            if flow is None or not flow.get("enabled", True):
                continue
            interval = _schedule_interval_minutes(flow)
            if interval is None:
                continue
            last = flow.get("last_scheduled_at")
            if last is None or _minutes_between(last, now) >= interval:
                due.append(flow)
        return due

    def tick(self) -> int:
        """Dispara los flujos que tocan. Devuelve cuántos arrancó."""
        now = self._clock()
        started = 0
        for flow in self.due_flows(now):
            try:
                if not self._runner.ready_to_start(flow):
                    continue
            except (OSError, ValueError):
                logger.warning("Entrada del flujo %s aún no disponible", flow["id"], exc_info=True)
                continue
            # Marca antes de arrancar para no duplicar el disparo en el tick siguiente.
            self._store.touch_scheduled_run(flow["id"], now)
            try:
                self._runner.start(flow["id"], {"source": "schedule", "at": now})
                started += 1
            except Exception:
                logger.warning("No se pudo programar la ejecución de %s", flow["id"], exc_info=True)
        return started


def _minutes_between(start_iso: str, end_iso: str) -> float:
    from datetime import datetime

    def _parse(value: str) -> datetime:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))

    try:
        return (_parse(end_iso) - _parse(start_iso)).total_seconds() / 60.0
    except (TypeError, ValueError):
        return float("inf")


_scheduler: FlowScheduler | None = None
_scheduler_lock = threading.Lock()


def get_flow_scheduler(store: FlowStore, handler_getter: Callable[[str], Any]) -> FlowScheduler:
    """Singleton perezoso del planificador (mismo store/registry que handlers)."""
    global _scheduler
    with _scheduler_lock:
        if _scheduler is None:
            from backend.core.flows.runner import FlowRunner

            _scheduler = FlowScheduler(store, FlowRunner(store, handler_getter))
        return _scheduler
