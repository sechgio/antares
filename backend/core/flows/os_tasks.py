"""Programación de flujos con la aplicación cerrada (Windows).

Registra una tarea en el Programador de tareas por cada flujo activo con
trigger ``schedule``; la tarea ejecuta ``AntaresBackend.exe --flow-run <id>``
sin abrir la ventana. Solo actúa en builds empaquetadas de Windows (o con
``ANTARES_FLOWS_OS_SCHEDULE=1`` para probarla); en desarrollo es no-op y el
planificador interno sigue cubriendo la app abierta.
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
from typing import Any

from backend.core.flows.types import JsonObject

logger = logging.getLogger(__name__)

_TASK_PREFIX = "AntaresFlow-"


def enabled() -> bool:
    if os.environ.get("ANTARES_FLOWS_OS_SCHEDULE") == "0":
        return False
    if sys.platform != "win32":
        return False
    return getattr(sys, "frozen", False) or os.environ.get("ANTARES_FLOWS_OS_SCHEDULE") == "1"


def _task_name(flow_id: str) -> str:
    return f"{_TASK_PREFIX}{flow_id}"


def _schedule_trigger(flow: JsonObject) -> JsonObject | None:
    if not flow.get("enabled"):
        return None
    trigger = next((n for n in flow["graph"]["nodes"] if n.get("kind") == "trigger"), None)
    config = (trigger or {}).get("config") or {}
    if config.get("trigger_kind") != "schedule":
        return None
    interval = config.get("interval_minutes", 60)
    if not isinstance(interval, int) or not 1 <= interval <= 10080:
        return None
    return {"interval_minutes": interval}


def _schtasks(*args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        ["schtasks", *args],
        capture_output=True,
        timeout=20,
        check=False,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def sync_flow_task(flow: JsonObject) -> None:
    """Crea/actualiza la tarea del flujo o la borra si ya no es programable."""
    if not enabled():
        return
    name = _task_name(str(flow["id"]))
    trigger = _schedule_trigger(flow)
    try:
        if trigger is None:
            _schtasks("/Delete", "/F", "/TN", name)
            return
        command = f'"{sys.executable}" --flow-run {flow["id"]}'
        _schtasks(
            "/Create", "/F", "/TN", name,
            "/SC", "MINUTE", "/MO", str(trigger["interval_minutes"]),
            "/TR", command,
        )
    except Exception:
        logger.exception("No se pudo sincronizar la tarea programada del flujo %s", flow["id"])


def delete_flow_task(flow_id: str) -> None:
    if not enabled():
        return
    try:
        _schtasks("/Delete", "/F", "/TN", _task_name(flow_id))
    except Exception:
        logger.exception("No se pudo borrar la tarea programada del flujo %s", flow_id)


def sync_all(store: Any) -> None:
    """Alinea las tareas con los flujos guardados y poda huérfanas."""
    if not enabled():
        return
    flows = store.list_flows()
    wanted: set[str] = set()
    for meta in flows:
        flow = store.get(str(meta["id"]))
        if flow is None:
            continue
        wanted.add(str(flow["id"]))
        sync_flow_task(flow)
    try:
        out = _schtasks("/Query", "/FO", "CSV", "/NH").stdout.decode("utf-8", errors="replace")
        for line in out.splitlines():
            fields = [field.strip('"') for field in line.split('","')]
            task = fields[0].rsplit("\\", 1)[-1] if fields else ""
            if task.startswith(_TASK_PREFIX) and task[len(_TASK_PREFIX):] not in wanted:
                _schtasks("/Delete", "/F", "/TN", task)
    except Exception:
        logger.exception("No se pudieron podar las tareas programadas de flujos")
