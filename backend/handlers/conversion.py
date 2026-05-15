"""Conversion process handlers: preview, start, status, cancel.

Supports concurrent jobs via JobManager while maintaining backward compatibility
with the legacy single-job frontend API.
"""
from __future__ import annotations

import os
import time
from concurrent.futures import CancelledError, ThreadPoolExecutor
from pathlib import Path
from typing import Any

from backend.core.converter import FORMATOS_SOPORTADOS, convertir_imagen, copiar_archivo, copiar_video, es_video
from backend.core.database import buscar_por_codigo
from backend.core.jobs import DEFAULT_JOB_ID, Job, get_job_manager
from backend.core.renamer import RenamerEngine
from backend.handlers.common import log_message, validate_params, with_locale
from backend.ipc_protocol import send_notification
from backend.utils.i18n import set_locale, t
from backend.utils.validators import parse_filename_parts


@with_locale
@validate_params("files")
def preview(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    files = params.get("files", [])
    patron = params.get("patron", "")
    secuencia = params.get("secuencia", 1)
    use_filename_seq = params.get("use_filename_seq", True)
    engine = RenamerEngine(patron, secuencia)
    file_seqs = {}
    codigos_manuales = {}
    for f in files:
        code, seq = parse_filename_parts(Path(f).name)
        codigos_manuales[Path(f).name] = code
        if use_filename_seq:
            file_seqs[Path(f).name] = seq

    def lookup(codigo: str) -> dict[str, Any] | None:
        return buscar_por_codigo(codigo)

    res = engine.preview_lote(files, lookup_fn=lookup, codigos_manuales=codigos_manuales, file_seqs=file_seqs)
    return {"preview": [{"origen": Path(orig).name, "nuevo": nuev, "en_bd": en_bd} for orig, nuev, en_bd in res]}


@with_locale
@validate_params("files", "destino")
def process_start(params: dict[str, Any]) -> dict[str, Any]:
    """Start a conversion job.

    Accepts optional job_id for concurrent jobs. Falls back to "default"
    for backward compatibility with legacy frontend.
    """
    files = params.get("files", [])
    if not files or not isinstance(files, list) or len(files) == 0:
        log_message(t("error.no_files_to_process"), "error")
        return {"started": False, "reason": "no_files"}
    destino = params.get("destino", "")
    if not destino:
        log_message(t("error.no_destination"), "error")
        return {"started": False, "reason": "no_destination"}

    job_id = params.get("job_id", DEFAULT_JOB_ID)
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


@with_locale
def process_status(params: dict[str, Any]) -> dict[str, Any]:
    """Get status of a conversion job.

    Accepts optional job_id. Falls back to "default" for backward compat.
    """
    job_id = params.get("job_id", DEFAULT_JOB_ID)
    mgr = get_job_manager()
    job = mgr.get_job(job_id)
    if job:
        return job.to_dict_detail()
    # Legacy fallback: return empty state if no job exists
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
    """Request cancellation of a conversion job.

    Accepts optional job_id. Falls back to "default" for backward compat.
    """
    job_id = params.get("job_id", DEFAULT_JOB_ID)
    mgr = get_job_manager()
    result = mgr.cancel_job(job_id)
    if result.get("cancelled"):
        log_message(t("info.process_cancelled"), "warn", state=mgr.get_job(job_id).state if mgr.get_job(job_id) else None)
    return result


@with_locale
def preview_image(params: dict[str, Any]) -> dict[str, str]:
    from backend.core.converter import convertir_a_preview
    return convertir_a_preview(params.get("path", ""), params.get("formato", "PNG"), params.get("calidad", 85), params.get("resize"))


@with_locale
def is_video(params: dict[str, Any]) -> dict[str, bool]:
    return {"is_video": es_video(params.get("path", ""))}


def _run_conversion_job(job: Job) -> None:
    """Thread target for a conversion job. Receives a Job object instead of raw params."""
    state = job.state
    params = job.params
    job_id = job.id
    is_default = job_id == DEFAULT_JOB_ID

    try:
        set_locale(params.get("locale", "es"))
        files = params.get("files", [])
        destino = params.get("destino", "")
        formato = params.get("formato", "JPEG")
        calidad = params.get("calidad", 95)
        conversion_enabled = params.get("conversion_enabled", True)
        resize_ancho = params.get("resize_ancho")
        resize_alto = params.get("resize_alto")
        keep_exif = params.get("keep_exif", False)
        usar_rename = params.get("usar_rename", True)
        patron = params.get("patron", "")
        secuencia = params.get("secuencia", 1)
        use_filename_seq = params.get("use_filename_seq", True)

        engine = RenamerEngine(patron, secuencia) if usar_rename else None
        try:
            rw = int(resize_ancho) if resize_ancho is not None else None
            rh = int(resize_alto) if resize_alto is not None else None
            resize = (rw, rh) if rw and rh and rw > 0 and rh > 0 else None
        except (ValueError, TypeError):
            resize = None

        if conversion_enabled and formato not in FORMATOS_SOPORTADOS:
            log_message(f"Formato no soportado: {formato}", "error", state=state)
            _notify_complete(job, 0, len(files))
            return

        ext_dest = FORMATOS_SOPORTADOS[formato]["ext"] if conversion_enabled else None
        total = len(files)

        tasks: list[tuple[str, Path, bool]] = []
        for fpath in files:
            p = Path(fpath)
            is_video_file = es_video(p)
            if engine:
                codigo, seq = parse_filename_parts(p.name)
                datos = buscar_por_codigo(codigo)
                fseq = seq if use_filename_seq else None
                nuevo_nombre = engine.aplicar(p, datos_bd=datos, codigo_manual=codigo, file_seq=fseq)
                if is_video_file or not conversion_enabled:
                    out_path = Path(destino) / nuevo_nombre
                else:
                    out_path = (Path(destino) / nuevo_nombre).with_suffix(ext_dest)
            else:
                out_path = Path(destino) / p.name if is_video_file or not conversion_enabled else Path(destino) / (p.stem + ext_dest)
            tasks.append((fpath, out_path, is_video_file))

        # Dynamic workers: up to 8, capped by CPU count but respecting memory.
        # For I/O-bound work (image conversion), we can oversubscribe CPU a bit.
        raw_cpu = os.cpu_count() or 2
        max_workers = max(4, min(raw_cpu * 2, 16))
        completed = 0

        def _process_one(task: tuple[str, Path, bool]) -> tuple[bool, str, str]:
            fpath, out_path, is_video_file = task
            p = Path(fpath)
            try:
                with state._lock:
                    if state.cancel_requested:
                        raise CancelledError()
                if is_video_file:
                    copiar_video(fpath, out_path)
                elif not conversion_enabled:
                    copiar_archivo(fpath, out_path)
                else:
                    convertir_imagen(fpath, out_path, formato, calidad, resize, keep_exif)
                return (True, out_path.name, "")
            except CancelledError:
                raise
            except Exception as e:
                return (False, p.name, str(e))

        pool = ThreadPoolExecutor(max_workers=max_workers)
        # Submit tasks in chunks to avoid memory bloat with thousands of futures.
        CHUNK_SIZE = 500
        cancelled = False
        pending_futures: list = []

        def _submit_chunk(start_idx: int) -> None:
            end_idx = min(start_idx + CHUNK_SIZE, len(tasks))
            for task in tasks[start_idx:end_idx]:
                pending_futures.append(pool.submit(_process_one, task))

        _submit_chunk(0)
        next_chunk_start = CHUNK_SIZE

        try:
            while pending_futures:
                # Remove completed futures efficiently
                still_pending = []
                for future in pending_futures:
                    if future.done():
                        if future.cancelled():
                            continue
                        try:
                            success, name, error = future.result()
                        except CancelledError:
                            continue
                        completed += 1
                        with state._lock:
                            if success:
                                state.ok_count += 1
                                log_message(f"{'Renombrado' if not conversion_enabled else 'Procesado'}: {name}", "ok", state=state)
                            else:
                                state.err_count += 1
                                log_message(t("error.process_failed", file=name, error=error), "error", state=state)
                            state.progress = int((completed / total) * 100)
                            state.current_file = name
                            progress = state.progress
                            current_file = state.current_file
                            ok_count = state.ok_count
                            err_count = state.err_count
                        # Send per-job notification and legacy notification
                        notif_data = {
                            "progress": progress, "current_file": current_file,
                            "ok_count": ok_count, "err_count": err_count,
                            "job_id": job_id,
                        }
                        send_notification(f"job.{job_id}.progress", notif_data)
                        if is_default:
                            send_notification("process.progress", {
                                "progress": progress, "current_file": current_file,
                                "ok_count": ok_count, "err_count": err_count,
                            })
                    else:
                        still_pending.append(future)
                pending_futures = still_pending

                with state._lock:
                    if state.cancel_requested and not cancelled:
                        cancelled = True
                        log_message(t("info.process_cancelled"), "warn", state=state)
                if cancelled:
                    for f in pending_futures:
                        f.cancel()
                    break

                # Submit next chunk if we have capacity and more tasks
                if len(pending_futures) < CHUNK_SIZE // 2 and next_chunk_start < len(tasks):
                    _submit_chunk(next_chunk_start)
                    next_chunk_start += CHUNK_SIZE

                if pending_futures:
                    time.sleep(0.05)
        finally:
            pool.shutdown(wait=False)

        with state._lock:
            state.running = False
            state.progress = 100 if not cancelled else state.progress
            ok_count = state.ok_count
            err_count = state.err_count

        job.result = {"ok_count": ok_count, "err_count": err_count, "cancelled": cancelled}

        if cancelled:
            log_message(t("info.process_cancelled"), "warn", state=state)
        else:
            log_message(t("info.process_complete", ok=ok_count, err=err_count), "info", state=state)
        _notify_complete(job, ok_count, err_count)

        from backend.core.history import save_run
        save_run(
            files=[str(f) for f in files],
            options={"formato": formato, "calidad": calidad, "conversion_enabled": conversion_enabled, "resize": str(resize) if resize else None, "keep_exif": keep_exif, "usar_rename": usar_rename},
            patron=patron, formato=formato, calidad=calidad,
            resize=str(resize) if resize else None, ok_count=ok_count, err_count=err_count,
        )
    finally:
        with state._lock:
            state.running = False


def _notify_complete(job: Job, ok_count: int, err_count: int) -> None:
    """Send job completion notifications."""
    is_default = job.id == DEFAULT_JOB_ID
    notif_data = {"ok_count": ok_count, "err_count": err_count, "job_id": job.id}
    send_notification(f"job.{job.id}.complete", notif_data)
    if is_default:
        send_notification("process.complete", {"ok_count": ok_count, "err_count": err_count})


HANDLERS = {
    "preview": preview,
    "process_start": process_start,
    "process_status": process_status,
    "process_cancel": process_cancel,
    "preview_image": preview_image,
    "is_video": is_video,
}
