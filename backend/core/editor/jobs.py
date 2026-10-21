from __future__ import annotations

import json
import logging
import threading
import uuid
from collections.abc import Callable
from concurrent.futures import wait
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, cast

from backend.core.editor.assets import AssetImportError, import_file
from backend.core.editor.toolchain import ToolchainError
from backend.core.observability import log_event
from backend.core.scheduler import get_scheduler
from backend.utils.paths import user_data_path

logger = logging.getLogger(__name__)

EDITOR_JOB_TYPES: frozenset[str] = frozenset({"editor_import"})

STAGES: tuple[str, ...] = ("validando", "copiando", "verificando", "registrando")


def _jobs_dir() -> Path:
    directory = user_data_path("editor") / "jobs"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _persist_job_record(job_id: str, record: dict[str, Any]) -> None:  # allowlist: dict[str, Any]
    path = _jobs_dir() / f"{job_id}.json"
    tmp = path.with_name(f".{job_id}.json.tmp")
    try:
        tmp.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        logger.debug("No se pudo persistir el registro del job %s", job_id, exc_info=True)


def _read_job_record(job_id: str) -> dict[str, Any] | None:  # allowlist: dict[str, Any]
    path = _jobs_dir() / f"{job_id}.json"
    if not path.is_file():
        return None
    try:
        return cast(dict[str, Any], json.loads(path.read_text(encoding="utf-8")))  # allowlist: dict[str, Any]
    except (OSError, json.JSONDecodeError):
        return None


def _history_dir() -> Path:
    directory = user_data_path("editor") / "exports"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _persist_export_history(job_id: str, entry: dict[str, Any]) -> None:  # allowlist: dict[str, Any]
    path = _history_dir() / f"{job_id}.json"
    tmp = path.with_name(f".{job_id}.json.tmp")
    try:
        tmp.write_text(json.dumps(entry, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        logger.debug("No se pudo persistir el historial de exportación %s", job_id, exc_info=True)


def list_export_history(limit: int = 50) -> list[dict[str, Any]]:  # allowlist: dict[str, Any]
    entries: list[dict[str, Any]] = []  # allowlist: dict[str, Any]
    for path in _history_dir().glob("*.json"):
        try:
            entry = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        entries.append(entry)
    entries.sort(key=lambda e: str(e.get("finishedAt", "")), reverse=True)
    return entries[:limit]


def _set_stage(job: Any, stage: str, progress: int) -> None:
    with job.state._lock:
        job.state.current_file = stage
        job.state.progress = progress


def _check_cancelled(job: Any) -> bool:
    with job.state._lock:
        return bool(job.state.cancel_requested)


def run_import_job(job: Any, *, assets_dir: Path | None = None) -> dict[str, Any]:  # allowlist: dict[str, Any]
    files = [str(t) for t in (job.params.get("files") or [])]
    total = len(files)
    imported: list[dict[str, Any]] = []  # allowlist: dict[str, Any]
    failed: list[dict[str, Any]] = []  # allowlist: dict[str, Any]
    with job.state._lock:
        job.state.total = total

    for index, token in enumerate(files):
        base = int(100 * index / max(total, 1))
        if _check_cancelled(job):
            with job.state._lock:
                job.result = {"imported": imported, "failed": failed, "cancelled": True}
            break
        _set_stage(job, f"{STAGES[0]}: {index + 1}/{total}", base + 5)
        try:
            _set_stage(job, f"{STAGES[1]}: {index + 1}/{total}", base + 30)
            _set_stage(job, f"{STAGES[2]}: {index + 1}/{total}", base + 70)
            asset = import_file(token, assets_dir=assets_dir)
            _set_stage(job, f"{STAGES[3]}: {index + 1}/{total}", base + 95)
            imported.append(asset)
            with job.state._lock:
                job.state.ok_count += 1
        except (AssetImportError, OSError, ValueError) as exc:
            failed.append({"token_suffix": _suffix(token), "reason": str(exc)})
            with job.state._lock:
                job.state.err_count += 1
                job.state.logs.insert(0, {"message": str(exc), "tag": "error"})

    result: dict[str, Any] = {  # allowlist: dict[str, Any]
        "imported": imported,
        "failed": failed,
        "cancelled": _check_cancelled(job),
    }
    if not _check_cancelled(job):
        with job.state._lock:
            job.state.progress = 100
    with job.state._lock:
        if job.result is None:
            job.result = result
    log_event(
        logger,
        logging.INFO,
        "editor.job.import_finished",
        job_id=job.id,
        imported=len(imported),
        failed=len(failed),
        outcome="success" if not failed and not result["cancelled"] else "partial",
    )
    return result


def _suffix(token: str) -> str:
    from pathlib import Path

    return Path(token).suffix.lower()


def start_import_job(
    job_manager: Any,
    files: list[str],
    *,
    request_id: str | None = None,
    assets_dir: Path | None = None,
    job_id: str | None = None,
) -> dict[str, Any]:  # allowlist: dict[str, Any]
    jid = job_id or f"editor_import_{uuid.uuid4().hex[:12]}"
    record = {
        "jobId": jid,
        "type": "editor_import",
        "requestId": request_id,
        "stages": list(STAGES),
        "fileCount": len(files),
        "state": "queued",
        "imported": [],
        "failed": [],
    }
    _persist_job_record(jid, record)

    started = job_manager.create_job(
        "editor_import",
        {"files": list(files), "file_count": len(files), "requestId": request_id},
        lambda job: run_import_job(job, assets_dir=assets_dir),
        job_id=jid,
    )
    if not started.get("started"):
        _persist_job_record(jid, {**record, "state": "rejected", "reason": started.get("reason")})
        return dict(started)
    return {"started": True, "jobId": jid}


def editor_job_status(job_id: str, job_manager: Any) -> dict[str, Any]:  # allowlist: dict[str, Any]
    record = _read_job_record(job_id)
    job = job_manager.get_job(job_id)
    if job is None and record is None:
        raise KeyError(job_id)
    status: dict[str, Any] = {  # allowlist: dict[str, Any]
        "jobId": job_id,
        "type": "editor_import",
        "stages": list(STAGES),
        "state": record.get("state", "unknown") if record else "unknown",
        "progress": 0,
        "stage": "",
        "imported": record.get("imported", []) if record else [],
        "failed": record.get("failed", []) if record else [],
        "running": False,
        "cancelled": False,
    }
    if job is not None:
        with job.state._lock:
            status["running"] = bool(job.state.running)
            status["progress"] = int(job.state.progress)
            status["stage"] = str(job.state.current_file)
            status["cancelled"] = bool(job.state.cancel_requested)
            status["ok_count"] = job.state.ok_count
            status["err_count"] = job.state.err_count
            result = job.result
        if isinstance(result, dict):
            status["imported"] = result.get("imported", status["imported"])
            status["failed"] = result.get("failed", status["failed"])
            status["cancelled"] = bool(result.get("cancelled", status["cancelled"]))
        if not status["running"]:
            status["state"] = "cancelled" if status["cancelled"] else ("failed" if status["err_count"] else "completed")
            if status["state"] != "cancelled" and status["progress"] < 100:
                status["state"] = "failed"
    return status


def is_editor_job(job_id: str) -> bool:
    return job_id.startswith("editor_import_") or _read_job_record(job_id) is not None


def cancel_editor_job(job_id: str, job_manager: Any) -> dict[str, Any]:  # allowlist: dict[str, Any]
    if not is_editor_job(job_id):
        raise KeyError(job_id)
    outcome = job_manager.cancel_job(job_id)
    if outcome.get("cancelled"):
        record = _read_job_record(job_id) or {"jobId": job_id}
        _persist_job_record(job_id, {**record, "state": "cancelling"})
    return dict(outcome)


EXPORT_STAGES: tuple[str, ...] = ("validando", "rendering", "verificando", "publicando")


def _run_heavy_editor_job(job: Any, operation: Callable[[], object]) -> None:
    def execute() -> object:
        if _check_cancelled(job):
            raise ToolchainError("trabajo cancelado")
        return operation()

    future = get_scheduler().submit_heavy(execute, block=True, cancel_check=lambda: _check_cancelled(job))
    if future is None:
        raise ToolchainError("trabajo cancelado")
    while not future.done():
        if _check_cancelled(job) and future.cancel():
            raise ToolchainError("trabajo cancelado")
        wait([future], timeout=0.2)
    future.result()


def run_export_job(job: Any, *, output: Path | None = None) -> dict[str, Any]:  # allowlist: dict[str, Any]
    from backend.core.editor.render import execute_render

    document = job.params.get("document") or {}
    if output is None:
        raise ValueError("el export requiere una ruta de salida")
    _set_stage(job, EXPORT_STAGES[0], 5)
    if _check_cancelled(job):
        raise ToolchainError("render cancelado")
    _set_stage(job, EXPORT_STAGES[1], 20)
    result = execute_render(
        document,
        output,
        cancel_check=_check_cancelled,
    )
    _set_stage(job, EXPORT_STAGES[2], 85)
    _set_stage(job, EXPORT_STAGES[3], 95)
    with job.state._lock:
        job.state.progress = 100
        if job.result is None:
            job.result = result
    _persist_export_history(
        job.id,
        {
            "jobId": job.id,
            "type": "editor_export",
            "output": str(output),
            "state": "done",
            "finishedAt": datetime.now(timezone.utc).isoformat(),
            "byteSize": output.stat().st_size if output.is_file() else 0,
        },
    )
    log_event(logger, logging.INFO, "editor.job.export_finished", job_id=job.id, output=str(output))
    return result


def start_export_job(
    job_manager: Any,
    document: dict[str, Any],  # allowlist: dict[str, Any]
    *,
    output: Path | None = None,
    request_id: str | None = None,
    job_id: str | None = None,
) -> dict[str, Any]:  # allowlist: dict[str, Any]
    jid = job_id or f"editor_export_{uuid.uuid4().hex[:12]}"
    record = {
        "jobId": jid,
        "type": "editor_export",
        "requestId": request_id,
        "stages": list(EXPORT_STAGES),
        "state": "queued",
    }
    _persist_job_record(jid, record)
    started = job_manager.create_job(
        "editor_export",
        {"document": document, "requestId": request_id},
        lambda job: _run_heavy_editor_job(job, lambda: run_export_job(job, output=output)),
        job_id=jid,
    )
    if not started.get("started"):
        _persist_job_record(jid, {**record, "state": "rejected", "reason": started.get("reason")})
        return dict(started)
    return {"started": True, "jobId": jid}


EFFECT_STAGES: tuple[str, ...] = ("analizando", "procesando", "verificando", "cacheando")
EFFECT_TYPES: frozenset[str] = frozenset({"stabilize", "chromakey"})


def run_effect_job(job: Any) -> dict[str, Any]:  # allowlist: dict[str, Any]
    from backend.core.editor.effects import apply_chromakey, apply_stabilize
    from backend.core.editor.render import asset_path
    from backend.core.editor.toolchain import resolve_toolchain

    document = job.params.get("document") or {}
    effect_type = str(job.params.get("effectType", ""))
    clip_id = job.params.get("clipId")
    if effect_type not in EFFECT_TYPES:
        raise ValueError(f"efecto desconocido: {effect_type}")

    clips = document.get("clips", [])
    clip = next((c for c in clips if c.get("id") == clip_id), None)
    if clip is None:
        raise ValueError("clip no encontrado en el snapshot")

    assets_by_id = {a["id"]: a for a in document.get("assets", [])}
    asset = assets_by_id.get(str(clip.get("assetId", "")))
    if asset is None:
        raise ValueError("el clip no tiene asset gestionado")

    toolchain = resolve_toolchain()
    source = asset_path(asset)
    cache_dir = user_data_path("editor") / "cache" / "effects"
    cache_dir.mkdir(parents=True, exist_ok=True)
    params_key = str(job.params.get("params", {}))
    target = cache_dir / f"{asset['id']}-{effect_type}-{abs(hash(params_key)) % 10**8}.out"

    _set_stage(job, EFFECT_STAGES[0], 10)
    if effect_type == "stabilize":
        shakiness = int(job.params.get("params", {}).get("shakiness", 6))
        _set_stage(job, EFFECT_STAGES[1], 30)
        apply_stabilize(toolchain, source, target, shakiness, transforms_file=target.with_suffix(".trf"), cancel_check=_check_cancelled)
    else:
        params = job.params.get("params", {})
        color = str(params.get("color", "#00FF00"))
        similarity = float(params.get("similarity", 0.3))
        blend = float(params.get("blend", 0.1))
        _set_stage(job, EFFECT_STAGES[1], 30)
        apply_chromakey(toolchain, source, target, color, similarity, blend)

    _set_stage(job, EFFECT_STAGES[2], 80)
    _set_stage(job, EFFECT_STAGES[3], 95)
    with job.state._lock:
        job.state.progress = 100
        if job.result is None:
            job.result = {"output": str(target), "effectType": effect_type}
    log_event(logger, logging.INFO, "editor.job.effect_finished", job_id=job.id, effect=effect_type)
    return {"output": str(target), "effectType": effect_type}


def start_effect_job(
    job_manager: Any,
    document: dict[str, Any],  # allowlist: dict[str, Any]
    effect_type: str,
    *,
    clip_id: str | None = None,
    request_id: str | None = None,
    job_id: str | None = None,
) -> dict[str, Any]:  # allowlist: dict[str, Any]
    if effect_type not in EFFECT_TYPES:
        raise ValueError(f"efecto desconocido: {effect_type}")
    jid = job_id or f"editor_effect_{uuid.uuid4().hex[:12]}"
    record = {
        "jobId": jid,
        "type": "editor_effect",
        "effectType": effect_type,
        "requestId": request_id,
        "stages": list(EFFECT_STAGES),
        "state": "queued",
    }
    _persist_job_record(jid, record)
    started = job_manager.create_job(
        "editor_effect",
        {"document": document, "effectType": effect_type, "clipId": clip_id, "requestId": request_id},
        lambda job: _run_heavy_editor_job(job, lambda: run_effect_job(job)),
        job_id=jid,
    )
    if not started.get("started"):
        _persist_job_record(jid, {**record, "state": "rejected", "reason": started.get("reason")})
        return dict(started)
    return {"started": True, "jobId": jid}


_lock = threading.Lock()
