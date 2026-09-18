from __future__ import annotations

from pathlib import Path
from typing import Any

from backend.core import conversion_probe, out_path_dedupe
from backend.core.converter import es_video
from backend.core.jobs import (
    Job,
    get_job_manager,
    resolve_job_id,
)
from backend.core.naming import resolve_rename_plan
from backend.core.renamer import RenamerEngine
from backend.core.state import log_message
from backend.handlers.common import validate_params, with_locale
from backend.handlers.conversion_job import _run_conversion_job
from backend.utils.i18n import t
from backend.utils.validators import parse_filename_parts

MAX_PREVIEW_FILES = 200


@with_locale
@validate_params("files")
def preview(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    files = params.get("files", [])
    total_files = len(files) if isinstance(files, list) else 0
    truncated = False
    if isinstance(files, list) and total_files > MAX_PREVIEW_FILES:
        files = files[:MAX_PREVIEW_FILES]
        truncated = True
    patron = params.get("patron", "")
    secuencia = params.get("secuencia", 1)
    use_column_rename = params.get("use_column_rename", False)
    key_column = params.get("key_column", "")
    file_mapping, _mapping_path = conversion_probe._resolve_file_mapping(params)
    word_separator = params.get("word_separator", "_")
    sequence_mode = conversion_probe._resolve_sequence_mode(params)
    engine = RenamerEngine(
        patron,
        secuencia,
        separador=word_separator,
        sequence_mode=sequence_mode,
    )
    file_seqs = {}
    codigos_manuales = {}
    for f in files:
        p = Path(f)
        code, seq = parse_filename_parts(p.name)
        codigos_manuales[p.name] = code
        file_seqs[p.name] = seq

    collisions: list[dict[str, Any]] = []
    res: list[tuple[str, str, bool]] = []
    detect_fields: dict[str, Any] = {}
    if file_mapping:
        from backend.core.mapping_index import MappingIndex

        mapping_index = MappingIndex(file_mapping)
        res = engine.preview_lote(
            files,
            codigos_manuales=codigos_manuales,
            file_seqs=file_seqs,
            file_mapping=mapping_index,
        )
        collisions = mapping_index.find_collisions(files)
    elif key_column:
        from backend.core.config_fields import get_field_names

        db_cols = get_field_names()
        detect_fields, probe = (
            conversion_probe._preview_detect_fields(files, db_cols) if db_cols else ({}, None)
        )
        resolved_key = conversion_probe._resolve_key_column(key_column, files, db_cols, probe_result=probe)
        if resolved_key != key_column:
            log_message(
                f"Columna ID '{key_column}' no encontrada en BD, usando '{resolved_key}'",
                "warn",
            )
        key_column = resolved_key
        with conversion_probe._engine_snapshot(engine):
            plan = resolve_rename_plan(files, engine, key_column=key_column)
        res = plan.items
    elif use_column_rename:
        with conversion_probe._engine_snapshot(engine):
            plan = resolve_rename_plan(files, engine, use_column_rename=True)
        res = plan.items
    else:
        with conversion_probe._engine_snapshot(engine):
            plan = resolve_rename_plan(files, engine)
        res = engine.preview_lote(
            files,
            lookup_fn=plan.lookup,
            codigos_manuales=plan.codigos_manuales,
            file_seqs=plan.file_seqs,
            sequence_groups=plan.sequence_groups,
        )

    if not file_mapping and res:
        reserved_preview: set[str] = set()
        destino = str(params.get("destino") or "").strip()
        disk_keys = out_path_dedupe._scan_dest_out_keys(destino) if destino else set()
        dest_base = Path(destino) if destino else None
        fake_tasks = [
            (orig, (dest_base / nuev) if dest_base else Path(nuev), False)
            for orig, nuev, _en_bd in res
        ]
        deduped = out_path_dedupe._dedupe_chunk_out_paths(fake_tasks, reserved_preview, disk_keys=disk_keys)
        res = [
            (orig, Path(out_path).name, en_bd)
            for (orig, _old, en_bd), (_o, out_path, _v) in zip(res, deduped, strict=True)
        ]

    payload: dict[str, Any] = {
        "preview": [{"origen": Path(orig).name, "nuevo": nuev, "en_bd": en_bd} for orig, nuev, en_bd in res],
    }
    if truncated:
        payload["truncated"] = True
        payload["total_files"] = total_files
    if detect_fields:
        payload.update(detect_fields)
    if collisions:
        payload["collisions"] = collisions
    return payload


@with_locale
@validate_params("files", "destino")
def process_start(params: dict[str, Any]) -> dict[str, Any]:
    files = params.get("files", [])
    if not files or not isinstance(files, list) or len(files) == 0:
        log_message(t("error.no_files_to_process"), "error")
        return {"started": False, "reason": "no_files"}
    destino = params.get("destino", "")
    if not destino:
        log_message(t("error.no_destination"), "error")
        return {"started": False, "reason": "no_destination"}

    job_id = resolve_job_id(params)
    mgr = get_job_manager()

    existing = mgr.get_job(job_id)
    if existing and existing.state.running:
        log_message(t("error.process_already_running"), "warn")
        return {"started": False, "reason": "already_running", "job_id": job_id}

    result = mgr.create_job(
        job_type="conversion",
        params=params,
        target=_run_conversion_job,
        job_id=job_id,
    )

    if result["started"]:
        job = mgr.get_job(result["job_id"])
        if job:
            with job.state._lock:
                job.state.total = len(files)

    return result


def _slim_process_status(job: Job) -> dict[str, Any]:
    with job.state._lock:
        logs = [dict(log) for log in job.state.logs]
        result = dict(job.result) if isinstance(job.result, dict) else job.result
    summary = job.to_dict()
    raw_params = job.params or {}
    files = raw_params.get("files") or []
    if isinstance(files, list) and files:
        file_count = len(files)
    else:
        stored = raw_params.get("file_count")
        file_count = stored if isinstance(stored, int) else 0
    return {
        **summary,
        "logs": logs,
        "result": result,
        "params": {
            "file_count": file_count,
            "destino": raw_params.get("destino"),
            "formato": raw_params.get("formato"),
        },
    }


@with_locale
def process_status(params: dict[str, Any]) -> dict[str, Any]:
    job_id = resolve_job_id(params)
    mgr = get_job_manager()
    job = mgr.get_job(job_id)
    if job:
        return _slim_process_status(job)
    return {
        "running": False,
        "progress": 0,
        "current_file": "",
        "ok_count": 0,
        "err_count": 0,
        "logs": [],
    }


@with_locale
def process_cancel(params: dict[str, Any]) -> dict[str, Any]:
    job_id = resolve_job_id(params)
    mgr = get_job_manager()
    result = mgr.cancel_job(job_id)
    if result.get("cancelled"):
        job = mgr.get_job(job_id)
        log_message(t("info.process_cancelled"), "warn", state=job.state if job else None)
    return result


@with_locale
def is_video(params: dict[str, Any]) -> dict[str, bool]:
    return {"is_video": es_video(params.get("path", ""))}


HANDLERS = {
    "preview": preview,
    "process_start": process_start,
    "process_status": process_status,
    "process_cancel": process_cancel,
    "is_video": is_video,
}
