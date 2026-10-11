"""Retirada única de Flujos: borra su estado, sus tareas programadas y los PDFs
cuya procedencia queda demostrada por una ejecución registrada.

Un PDF solo se borra si su ruta exacta figura como ``saved_path``/``saved_paths``
de un paso correcto y no se modificó después de terminar ese paso. El resto queda
en el manifiesto como pendiente. La carpeta de estado se borra al final y el
marcador se escribe después: un fallo intermedio se reanuda en el siguiente
arranque sin repetir borrados (los archivos ya ausentes se omiten).
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

from backend.core.integrations.types import JsonObject
from backend.utils.atomic_write import atomic_write_json
from backend.utils.paths import user_data_path

logger = logging.getLogger(__name__)

_TASK_PREFIX = "AntaresFlow-"
_HEADLESS_MUTEX = "Local\\AntaresFlowsHeadless"


def _read_json(path: Path) -> dict[str, JsonObject]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {str(k): v for k, v in data.items() if isinstance(v, dict)} if isinstance(data, dict) else {}


def _timestamp(value: object) -> float | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)).timestamp()


def _delete_os_task(name: str) -> None:
    if sys.platform != "win32":
        return
    subprocess.run(
        ["schtasks", "/Delete", "/F", "/TN", name],
        capture_output=True,
        timeout=20,
        check=False,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def _headless_running() -> bool:
    """True si sigue vivo un ``--flow-run`` de una versión anterior."""
    if sys.platform != "win32":
        return False
    import ctypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    handle = kernel32.OpenMutexW(0x00100000, False, _HEADLESS_MUTEX)  # SYNCHRONIZE
    if not handle:
        return False
    kernel32.CloseHandle(handle)
    return True


def _output_candidates(runs: dict[str, JsonObject]) -> list[tuple[str, float | None]]:
    candidates: list[tuple[str, float | None]] = []
    for run in runs.values():
        steps = run.get("steps")
        for step in steps if isinstance(steps, list) else []:
            if not isinstance(step, dict) or step.get("status") != "success":
                continue
            output = step.get("output")
            if not isinstance(output, dict):
                continue
            paths = [output.get("saved_path")]
            saved = output.get("saved_paths")
            paths.extend(saved if isinstance(saved, list) else [])
            finished = _timestamp(step.get("finished_at")) or _timestamp(run.get("finished_at"))
            candidates.extend((p, finished) for p in paths if isinstance(p, str) and p)
    return candidates


def _delete_output(raw: str, finished: float | None) -> str | None:
    """Borra el PDF si su procedencia es demostrable; si no, devuelve el motivo."""
    path = Path(raw)
    if not path.is_absolute():
        return "ruta no absoluta"
    if not path.exists() and not path.is_symlink():
        return None
    if path.is_symlink() or any(parent.is_symlink() for parent in path.parents):
        return "enlace simbólico"
    if not path.is_file():
        return "no es un archivo"
    if finished is None:
        return "la ejecución no registra hora de término"
    if path.stat().st_mtime > finished:
        return "modificado después de la ejecución"
    path.unlink()
    return None


def retire_flows(
    flows_dir: Path | None = None,
    marker: Path | None = None,
    delete_task: Callable[[str], None] = _delete_os_task,
    headless_running: Callable[[], bool] = _headless_running,
) -> JsonObject:
    marker = marker or user_data_path("ai-agent/flows-retirement.json")
    flows_dir = flows_dir or user_data_path("flows")
    try:
        done = json.loads(marker.read_text(encoding="utf-8")) if marker.exists() else None
    except (OSError, json.JSONDecodeError):
        done = None
    if isinstance(done, dict) and done.get("status") == "completed":
        return done
    if headless_running():
        logger.info("Retirada de Flujos aplazada: sigue activa una ejecución programada")
        return {"status": "deferred"}

    flows = _read_json(flows_dir / "flows.json")
    runs = _read_json(flows_dir / "flow_runs.json")
    tasks = [f"{_TASK_PREFIX}{flow_id}" for flow_id in flows]
    for name in tasks:
        try:
            delete_task(name)
        except Exception:
            logger.warning("No se pudo borrar la tarea programada %s", name, exc_info=True)

    deleted: list[str] = []
    pending: list[JsonObject] = []
    seen: set[str] = set()
    covered = {p for p, _ in _output_candidates(runs)}
    for raw, finished in _output_candidates(runs):
        key = os.path.normcase(raw)
        if key in seen:
            continue
        seen.add(key)
        existed = Path(raw).exists()
        try:
            reason = _delete_output(raw, finished)
        except OSError as exc:
            reason = f"no se pudo borrar: {exc.strerror or exc}"
        if reason:
            pending.append({"path": raw, "reason": reason})
        elif existed:
            deleted.append(raw)
    for flow in flows.values():
        artifacts = flow.get("source_artifacts")
        for paths in artifacts.values() if isinstance(artifacts, dict) else []:
            for raw in paths if isinstance(paths, list) else []:
                if isinstance(raw, str) and raw not in covered and Path(raw).exists():
                    pending.append({"path": raw, "reason": "sin ejecución registrada que lo generara"})

    if flows_dir.exists():
        shutil.rmtree(flows_dir)
    result: JsonObject = {
        "status": "completed",
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "flows": len(flows),
        "runs": len(runs),
        "tasks": tasks,
        "deleted": deleted,
        "pending": pending,
    }
    marker.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_json(marker, result)
    logger.info("Flujos retirado: %s PDFs borrados, %s pendientes", len(deleted), len(pending))
    return result
