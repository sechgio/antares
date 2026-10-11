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
import tempfile
import threading
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from typing import Any

from backend.core.flows.types import JsonObject

logger = logging.getLogger(__name__)

_TASK_PREFIX = "AntaresFlow-"

# Mutexes con nombre de Windows: ``GUI`` lo retiene el backend de la app
# abierta, ``HEADLESS`` cada ejecución ``--flow-run`` del Programador de tareas
# y ``STORE`` serializa las lectura-modificación-escritura de los stores de
# flujos entre procesos. Fuera de Windows no aplican.
GUI_MUTEX = "Local\\AntaresFlowsGui"
HEADLESS_MUTEX = "Local\\AntaresFlowsHeadless"
STORE_MUTEX = "Local\\AntaresFlowsStore"


def _kernel32() -> Any:
    import ctypes
    from ctypes import wintypes

    win_dll_name = "WinDLL"  # getattr sortea B009 y el stub de mypy fuera de Windows
    kernel32 = getattr(ctypes, win_dll_name)("kernel32", use_last_error=True)
    kernel32.CreateMutexW.argtypes = (wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR)
    kernel32.CreateMutexW.restype = wintypes.HANDLE
    kernel32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    kernel32.ReleaseMutex.argtypes = (wintypes.HANDLE,)
    kernel32.ReleaseMutex.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.CloseHandle.restype = wintypes.BOOL
    return kernel32


def mutex_held(name: str) -> bool:
    """True si otro proceso ya retiene el mutex nombrado (solo Windows)."""
    if sys.platform != "win32":
        return False
    kernel32 = _kernel32()
    handle = kernel32.CreateMutexW(None, False, name)
    if not handle:
        return False
    try:
        if kernel32.WaitForSingleObject(handle, 0) in (0, 0x80):  # libre o abandonado
            kernel32.ReleaseMutex(handle)
            return False
        return True  # WAIT_TIMEOUT: lo retiene otro proceso
    finally:
        kernel32.CloseHandle(handle)


def hold_mutex(name: str, timeout_ms: int) -> Any:
    """Adquiere el mutex nombrado y devuelve su handle, o ``None`` al fallar.

    El llamador debe guardar el handle para que el mutex viva hasta que el
    proceso termine. Fuera de Windows devuelve ``None`` (no aplica).
    """
    if sys.platform != "win32":
        return None
    kernel32 = _kernel32()
    handle = kernel32.CreateMutexW(None, False, name)
    if not handle:
        return None
    if kernel32.WaitForSingleObject(handle, timeout_ms) in (0, 0x80):
        return handle
    kernel32.CloseHandle(handle)
    return None


def release_mutex(handle: Any) -> None:
    if sys.platform != "win32" or handle is None:
        return
    kernel32 = _kernel32()
    kernel32.ReleaseMutex(handle)
    kernel32.CloseHandle(handle)


class ProcessLock:
    """``threading.RLock`` + mutex con nombre de Windows entre procesos.

    Cubre las lectura-modificación-escritura compartidas: fuera de Windows el
    modo ``--flow-run`` no existe y basta el lock local.
    """

    def __init__(self, name: str) -> None:
        self._name = name
        self._local = threading.RLock()
        self._handle: Any = None

    def __enter__(self) -> ProcessLock:
        self._local.acquire()
        if sys.platform != "win32":
            return self
        kernel32 = _kernel32()
        if self._handle is None:
            self._handle = kernel32.CreateMutexW(None, False, self._name)
        if self._handle:
            kernel32.WaitForSingleObject(self._handle, 0xFFFFFFFF)  # INFINITE
        return self

    def __exit__(self, *exc_info: Any) -> None:
        try:
            if sys.platform != "win32" or not self._handle:
                return
            _kernel32().ReleaseMutex(self._handle)
        finally:
            self._local.release()


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
    if config.get("trigger_kind") != "schedule" or config.get("runtime") == "app_open":
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


def _task_xml(flow_id: str, interval_minutes: int) -> bytes:
    namespace = "http://schemas.microsoft.com/windows/2004/02/mit/task"
    def add(parent: ET.Element, name: str, value: str | None = None, **attrs: str) -> ET.Element:
        child = ET.SubElement(parent, f"{{{namespace}}}{name}", attrs)
        if value is not None:
            child.text = value
        return child

    now = datetime.now().astimezone().replace(microsecond=0).isoformat(timespec="seconds")
    task = ET.Element(f"{{{namespace}}}Task", {"version": "1.2"})
    registration = add(task, "RegistrationInfo")
    add(registration, "Author", "Antares")
    triggers = add(task, "Triggers")
    trigger = add(triggers, "TimeTrigger")
    add(trigger, "StartBoundary", now)
    add(trigger, "Enabled", "true")
    repetition = add(trigger, "Repetition")
    add(repetition, "Interval", f"PT{interval_minutes}M")
    principals = add(task, "Principals")
    principal = add(principals, "Principal", id="Author")
    add(principal, "UserId", os.environ.get("USERNAME", ""))
    add(principal, "LogonType", "InteractiveToken")
    add(principal, "RunLevel", "LeastPrivilege")
    settings = add(task, "Settings")
    add(settings, "MultipleInstancesPolicy", "IgnoreNew")
    add(settings, "DisallowStartIfOnBatteries", "false")
    add(settings, "StopIfGoingOnBatteries", "false")
    add(settings, "StartWhenAvailable", "true")
    add(settings, "ExecutionTimeLimit", "PT15M")
    add(settings, "Enabled", "true")
    actions = add(task, "Actions", Context="Author")
    action = add(actions, "Exec")
    add(action, "Command", sys.executable)
    add(action, "Arguments", f"--flow-run {flow_id}")
    add(action, "WorkingDirectory", str(Path(sys.executable).parent))
    return bytes(ET.tostring(task, encoding="utf-16", xml_declaration=True))


def _register_flow_task(name: str, flow_id: str, interval_minutes: int) -> bool:
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(prefix="antares-flow-", suffix=".xml", delete=False) as xml_file:
            temp_path = xml_file.name
            xml_file.write(_task_xml(flow_id, interval_minutes))
        result = _schtasks("/Create", "/F", "/TN", name, "/XML", temp_path)
        if result.returncode != 0:
            error = result.stderr.decode("utf-8", errors="replace").strip()
            logger.error("schtasks no pudo registrar %s (código %s): %s", name, result.returncode, error)
            return False
        return True
    except Exception:
        logger.exception("No se pudo registrar la tarea programada %s", name)
        return False
    finally:
        if temp_path is not None:
            try:
                os.unlink(temp_path)
            except OSError:
                logger.warning("No se pudo borrar el XML temporal de la tarea %s", name)


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
        _register_flow_task(name, str(flow["id"]), int(trigger["interval_minutes"]))
    except Exception:
        logger.exception("No se pudo sincronizar la tarea programada del flujo %s", flow["id"])


def delete_flow_task(flow_id: str) -> None:
    if not enabled():
        return
    try:
        _schtasks("/Delete", "/F", "/TN", _task_name(flow_id))
    except Exception:
        logger.exception("No se pudo borrar la tarea programada del flujo %s", flow_id)
