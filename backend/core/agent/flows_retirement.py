"""Retirada única de Flujos: borra su estado, sus tareas programadas y los PDFs
cuya procedencia queda demostrada por una ejecución registrada.

Un PDF solo se borra si su ruta exacta figura como ``saved_path``/``saved_paths``
de un productor PDF registrado en el grafo del run, no fue reutilizado y no se
escribió antes de iniciar ni después de terminar ese paso. El resto queda
en el manifiesto como pendiente. El manifiesto se persiste antes de los efectos
y conserva los recursos restantes; la carpeta de estado se borra al final salvo
que contenga una salida pendiente.
"""

from __future__ import annotations

import csv
import io
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
_PDF_OUTPUT_METHODS = (
    "flows_render_pdf", "canvas_export_cmyk_pdf", "formatos_generate",
    "evidencia_volanteo_render", "panel_aviso_corte_render_pdf", "sellador_apply",
)


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
    tasks = subprocess.run(
        ["schtasks", "/Query", "/FO", "CSV", "/NH"],
        capture_output=True, timeout=20, check=True,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    names = {row[0].lstrip("\\") for row in csv.reader(io.StringIO(tasks.stdout.decode(errors="replace"))) if row}
    if name not in names:
        return
    subprocess.run(
        ["schtasks", "/Delete", "/F", "/TN", name],
        capture_output=True,
        timeout=20,
        check=True,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def _headless_running() -> bool:
    if sys.platform != "win32":
        return False
    import ctypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    handle = kernel32.OpenMutexW(0x00100000, False, _HEADLESS_MUTEX)  # SYNCHRONIZE
    if not handle:
        return False
    kernel32.CloseHandle(handle)
    return True


def _output_candidates(runs: dict[str, JsonObject]) -> list[tuple[str, float | None, float | None, bool]]:
    candidates: list[tuple[str, float | None, float | None, bool]] = []
    for run in runs.values():
        graph = run.get("graph")
        nodes = graph.get("nodes") if isinstance(graph, dict) else []
        pdf_nodes = {
            node["id"] for node in nodes if isinstance(node, dict) and isinstance(node.get("id"), str)
            and node.get("kind") == "tool_call" and isinstance(node.get("config"), dict)
            and node["config"].get("method") in _PDF_OUTPUT_METHODS
        } if isinstance(nodes, list) else set()
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
            started = _timestamp(step.get("started_at"))
            finished = _timestamp(step.get("finished_at")) or _timestamp(run.get("finished_at"))
            proven = (step.get("kind") == "tool_call" and isinstance(step.get("node_id"), str)
                      and step["node_id"] in pdf_nodes and output.get("reused") is not True)
            candidates.extend((p, started, finished, proven) for p in paths if isinstance(p, str) and p)
    return candidates


def _delete_output(raw: str, finished: float | None, started: float | None) -> str | None:
    path = Path(raw)
    if not path.is_absolute():
        return "ruta no absoluta"
    if not path.exists() and not path.is_symlink():
        return None
    if path.is_symlink() or any(parent.is_symlink() for parent in path.parents):
        return "enlace simbólico"
    if not path.is_file():
        return "no es un archivo"
    if path.suffix.lower() != ".pdf":
        return "no es un PDF"
    with path.open("rb") as stream:
        if stream.read(5) != b"%PDF-":
            return "no es un PDF"
    if finished is None:
        return "la ejecución no registra hora de término"
    if started is None:
        return "la ejecución no registra hora de inicio"
    modified = path.stat().st_mtime
    if modified > finished:
        return "modificado después de la ejecución"
    if modified < started:
        return "anterior al inicio del paso"
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

    marker.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(done, dict) and done.get("status") in {"retiring", "deferred"}:
        result = done
    else:
        flows = _read_json(flows_dir / "flows.json")
        runs = _read_json(flows_dir / "flow_runs.json")
        tasks = [f"{_TASK_PREFIX}{flow_id}" for flow_id in flows]
        outputs: dict[str, JsonObject] = {}
        for raw, started, finished, proven in _output_candidates(runs):
            outputs.setdefault(os.path.normcase(raw), {"path": raw, "started": started, "finished": finished,
                                                      "existed": Path(raw).exists(), "proven": proven})
        pending = []
        for flow in flows.values():
            artifacts = flow.get("source_artifacts")
            for paths in artifacts.values() if isinstance(artifacts, dict) else []:
                for raw in paths if isinstance(paths, list) else []:
                    if isinstance(raw, str) and os.path.normcase(raw) not in outputs and Path(raw).exists():
                        pending.append({"path": raw, "reason": "sin ejecución registrada que lo generara"})
        result = {"status": "retiring", "flows": len(flows), "runs": len(runs), "tasks": tasks,
                  "remaining_tasks": list(tasks), "outputs": list(outputs.values()), "deleted": [], "pending": pending}
        atomic_write_json(marker, result)

    failed_tasks = []
    for name in list(result["remaining_tasks"]):
        try:
            delete_task(name)
        except Exception:
            logger.warning("No se pudo borrar la tarea programada %s", name, exc_info=True)
            failed_tasks.append(name)
            continue
        result["remaining_tasks"].remove(name)
        atomic_write_json(marker, result)
    if failed_tasks:
        result.update({"status": "deferred", "pending_tasks": failed_tasks})
        atomic_write_json(marker, result)
        return result
    result["status"] = "retiring"
    result.pop("pending_tasks", None)
    for output in list(result["outputs"]):
        raw = str(output["path"])
        try:
            reason = (_delete_output(raw, output["finished"], output.get("started")) if output.get("proven") is True
                      else "sin ejecución registrada que lo generara")
        except OSError as exc:
            reason = f"no se pudo borrar: {exc.strerror or exc}"
        if reason:
            result["pending"].append({"path": raw, "reason": reason})
        elif output["existed"]:
            result["deleted"].append(raw)
        result["outputs"].remove(output)
        atomic_write_json(marker, result)

    state_root = Path(os.path.abspath(flows_dir))
    contains_pending = any(
        Path(os.path.abspath(item["path"])).is_relative_to(state_root) and Path(item["path"]).exists()
        for item in result["pending"]
    )
    if flows_dir.exists() and not contains_pending:
        shutil.rmtree(flows_dir)
    result.pop("outputs")
    result.pop("remaining_tasks")
    result.update({"status": "completed", "completed_at": datetime.now(timezone.utc).isoformat()})
    atomic_write_json(marker, result)
    logger.info("Flujos retirado: %s PDFs borrados, %s pendientes", len(result["deleted"]), len(result["pending"]))
    return result
