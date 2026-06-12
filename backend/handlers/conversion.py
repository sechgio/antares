"""Conversion process handlers: preview, start, status, cancel.

Supports concurrent jobs via JobManager while maintaining backward compatibility
with the legacy single-job frontend API.

See backend/core/jobs.py for the full explanation of the legacy layer.
"""
from __future__ import annotations

import time
from concurrent.futures import ALL_COMPLETED, CancelledError, wait
from pathlib import Path
from typing import Any

from backend.core.converter import FORMATOS_SOPORTADOS, convertir_imagen, copiar_archivo, copiar_video, es_video
from backend.core.jobs import (
    Job,
    get_job_manager,
    is_legacy_default_job,
    resolve_job_id,
)
from backend.core.renamer import RenamerEngine
from backend.core.scheduler import get_scheduler
from backend.handlers.common import log_message, validate_params, with_locale
from backend.ipc_protocol import send_notification
from backend.utils.i18n import set_locale, t
from backend.utils.validators import parse_filename_parts

_CANCEL_GRACE_SECONDS = 0.25


@with_locale
@validate_params("files")
def preview(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    from backend.core.database import buscar_lote_por_codigos, buscar_por_columna, obtener_todos

    files = params.get("files", [])
    patron = params.get("patron", "")
    secuencia = params.get("secuencia", 1)
    use_filename_seq = params.get("use_filename_seq", True)
    use_column_rename = params.get("use_column_rename", False)
    key_column = params.get("key_column", "")
    file_mapping = params.get("mapping") or None
    engine = RenamerEngine(patron, secuencia)
    file_seqs = {}
    codigos_manuales = {}
    codigos_list = []
    stems = []
    for f in files:
        p = Path(f)
        code, seq = parse_filename_parts(p.name)
        codigos_manuales[p.name] = code
        codigos_list.append(code)
        stems.append(p.stem)
        if use_filename_seq:
            file_seqs[p.name] = seq

    collisions: list[dict[str, Any]] = []
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
        # Buscamos por código parseado y por stem completo para máxima compatibilidad
        db_cache = buscar_por_columna(list(set(codigos_list + stems)), key_column)
        res: list[tuple[str, str, bool]] = []
        seq_backup = engine.secuencia
        for f in files:
            p = Path(f)
            code = codigos_manuales[p.name]
            stem = p.stem
            datos = db_cache.get(code) or db_cache.get(stem)
            if datos:
                fseq = file_seqs.get(p.name) if use_filename_seq else None
                nombre_nuevo = engine.aplicar(f, datos_bd=datos, codigo_manual=code, file_seq=fseq)
                res.append((f, nombre_nuevo, True))
            else:
                res.append((f, p.name, False))
        engine.secuencia = seq_backup
    elif use_column_rename:
        db_cache = {str(i): rec for i, rec in enumerate(obtener_todos(limit=len(files)))}
        def lookup(codigo: str) -> dict[str, Any] | None:
            idx = str(codigos_list.index(codigo)) if codigo in codigos_list else None
            return db_cache.get(idx) if idx else None
        res = engine.preview_lote(files, lookup_fn=lookup, codigos_manuales=codigos_manuales, file_seqs=file_seqs)
    else:
        db_cache = buscar_lote_por_codigos(codigos_list)
        def lookup(codigo: str) -> dict[str, Any] | None:
            return db_cache.get(codigo)
        res = engine.preview_lote(files, lookup_fn=lookup, codigos_manuales=codigos_manuales, file_seqs=file_seqs)

    payload: dict[str, Any] = {
        "preview": [{"origen": Path(orig).name, "nuevo": nuev, "en_bd": en_bd} for orig, nuev, en_bd in res],
    }
    if collisions:
        payload["collisions"] = collisions
    return payload


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


@with_locale
def process_status(params: dict[str, Any]) -> dict[str, Any]:
    """Get status of a conversion job.

    Accepts optional job_id. Falls back to "default" for backward compat.
    """
    job_id = resolve_job_id(params)
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
    job_id = resolve_job_id(params)
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
    from backend.core.database import buscar_lote_por_codigos

    state = job.state
    params = job.params
    job_id = job.id
    is_default = is_legacy_default_job(job_id)

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
        use_column_rename = params.get("use_column_rename", False)
        key_column = params.get("key_column", "")
        file_mapping = params.get("mapping") or None
        mapping_path = params.get("mapping_path") or ""
        mapping_index = None

        if mapping_path and not file_mapping:
            from backend.core.database import parse_id_rename_mapping

            file_mapping = parse_id_rename_mapping(mapping_path)

        if file_mapping is not None:
            if not isinstance(file_mapping, dict) or len(file_mapping) == 0:
                log_message("El mapeo de renombrado está vacío o es inválido", "error", state=state)
                _notify_complete(job, 0, len(params.get("files", [])))
                return
            for _key, value in file_mapping.items():
                if not isinstance(value, str) or not value.strip():
                    log_message("El mapeo contiene valores de RENOMBRE vacíos o inválidos", "error", state=state)
                    _notify_complete(job, 0, len(params.get("files", [])))
                    return
            from backend.core.mapping_index import MappingIndex

            mapping_index = MappingIndex(file_mapping)
            collisions = mapping_index.find_collisions(files)
            if collisions:
                conflict = collisions[0]
                log_message(
                    f"Colisión de nombres de salida: '{conflict['output']}' "
                    f"({len(conflict['sources'])} archivos). Corrige el Excel antes de continuar.",
                    "error",
                    state=state,
                )
                _notify_complete(job, 0, len(files))
                return
            log_message(f"Modo: Renombrado por mapeo directo ({len(file_mapping)} entradas)", "info", state=state)

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

        CHUNK_SIZE = _calculate_chunk_size()
        scheduler = get_scheduler()
        cancelled = False
        _last_notify_time = 0.0
        _NOTIFY_INTERVAL = 0.5
        _min_progress_delta = 1  # Minimum progress change to trigger notification (1%)

        try:
            for chunk_start in range(0, len(files), CHUNK_SIZE):
                if cancelled:
                    break
                chunk_end = min(chunk_start + CHUNK_SIZE, len(files))
                chunk_files = files[chunk_start:chunk_end]
                chunk_tasks = _prepare_chunk_tasks(
                    chunk_files,
                    destino=destino,
                    engine=engine,
                    conversion_enabled=conversion_enabled,
                    ext_dest=ext_dest,
                    use_filename_seq=use_filename_seq,
                    lookup_fn=buscar_lote_por_codigos,
                    use_column_rename=use_column_rename,
                    global_offset=chunk_start,
                    key_column=key_column,
                    mapping_index=mapping_index,
                )
                futures = []
                for task in chunk_tasks:
                    future = scheduler.submit_heavy(
                        _process_one,
                        task,
                        block=True,
                        cancel_check=lambda: state.cancel_requested,
                    )
                    if future is None:
                        cancelled = True
                        break
                    futures.append(future)

                if cancelled:
                    for future in futures:
                        future.cancel()
                    wait(futures, timeout=_CANCEL_GRACE_SECONDS, return_when=ALL_COMPLETED)
                    break

                with state._lock:
                    if state.cancel_requested:
                        cancelled = True
                        log_message(t("info.process_cancelled"), "warn", state=state)
                if cancelled:
                    for future in futures:
                        future.cancel()
                    wait(futures, timeout=_CANCEL_GRACE_SECONDS, return_when=ALL_COMPLETED)
                    break

                for future in futures:
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
                        old_progress = state.progress
                        state.progress = int((completed / total) * 100)
                        state.current_file = name
                        progress = state.progress
                        current_file = state.current_file
                        ok_count = state.ok_count
                        err_count = state.err_count
                        progress_delta = progress - old_progress

                    now = time.time()
                    is_last = completed == total
                    # Adaptive throttling: notify if enough time passed OR significant progress change
                    should_notify = is_last or (now - _last_notify_time >= _NOTIFY_INTERVAL) or (progress_delta >= _min_progress_delta)
                    if should_notify:
                        _last_notify_time = now
                        notif_data = {
                            "progress": progress, "current_file": current_file,
                            "ok_count": ok_count, "err_count": err_count,
                            "job_id": job_id,
                        }
                        _emit_progress_notifications(job_id, notif_data, is_default)

                    # Check cancellation between completions
                    with state._lock:
                        if state.cancel_requested and not cancelled:
                            cancelled = True
                            log_message(t("info.process_cancelled"), "warn", state=state)
                    if cancelled:
                        for pending in futures:
                            pending.cancel()
                        break
        finally:
            if cancelled:
                wait(futures if "futures" in locals() else [], timeout=_CANCEL_GRACE_SECONDS, return_when=ALL_COMPLETED)

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
        rename_source = "mapping" if mapping_index else ("catalog" if key_column else "none")
        save_run(
            files=[str(f) for f in files],
            options={
                "formato": formato,
                "calidad": calidad,
                "conversion_enabled": conversion_enabled,
                "resize": str(resize) if resize else None,
                "keep_exif": keep_exif,
                "usar_rename": usar_rename,
                "use_column_rename": use_column_rename,
                "rename_source": rename_source,
                "mapping_mode": mapping_index is not None,
                "mapping_path": mapping_path or None,
                "key_column": key_column or None,
            },
            patron=patron, formato=formato, calidad=calidad,
            resize=str(resize) if resize else None, ok_count=ok_count, err_count=err_count,
        )
    finally:
        with state._lock:
            state.running = False


def _emit_progress_notifications(job_id: str, data: dict[str, Any], is_default: bool) -> None:
    """Send modern job progress notification + legacy one when needed."""
    send_notification(f"job.{job_id}.progress", data)
    if is_default:
        send_notification("process.progress", {
            "progress": data["progress"],
            "current_file": data["current_file"],
            "ok_count": data["ok_count"],
            "err_count": data["err_count"],
        })


def _emit_complete_notifications(job: Job, ok_count: int, err_count: int) -> None:
    """Send modern job complete notification + legacy one when needed."""
    is_default = is_legacy_default_job(job.id)
    notif_data = {"ok_count": ok_count, "err_count": err_count, "job_id": job.id}
    send_notification(f"job.{job.id}.complete", notif_data)
    if is_default:
        send_notification("process.complete", {"ok_count": ok_count, "err_count": err_count})


# Backwards-compatible alias (used internally by _run_conversion_job)
_notify_complete = _emit_complete_notifications


HANDLERS = {
    "preview": preview,
    "process_start": process_start,
    "process_status": process_status,
    "process_cancel": process_cancel,
    "preview_image": preview_image,
    "is_video": is_video,
}


def _calculate_chunk_size() -> int:
    """Choose an adaptive chunk size without materializing the full batch."""
    try:
        import psutil

        available_gb = psutil.virtual_memory().available / (1024 ** 3)
        target_ram_per_chunk = available_gb * 0.25
        chunk_size = int((target_ram_per_chunk * 1024) / 5)
        return max(50, min(chunk_size, 1000))
    except ImportError:
        return 500


def _prepare_chunk_tasks(
    chunk_files: list[str],
    *,
    destino: str,
    engine: RenamerEngine | None,
    conversion_enabled: bool,
    ext_dest: str | None,
    use_filename_seq: bool,
    lookup_fn,
    use_column_rename: bool = False,
    global_offset: int = 0,
    key_column: str = "",
    mapping_index: Any | None = None,
) -> list[tuple[str, Path, bool]]:
    """Prepare one chunk of file work and batch only that chunk's DB lookup."""
    db_cache: dict[str, dict] = {}
    if engine and mapping_index:
        pass
    elif engine:
        if key_column:
            from backend.core.database import buscar_por_columna
            codigos = [parse_filename_parts(Path(f).name)[0] for f in chunk_files]
            stems = [Path(f).stem for f in chunk_files]
            # Buscamos por código parseado y por stem completo
            db_cache = buscar_por_columna(list(set(codigos + stems)), key_column)
        elif use_column_rename:
            from backend.core.database import obtener_todos
            all_records = obtener_todos(limit=len(chunk_files), offset=global_offset)
            for i, rec in enumerate(all_records):
                db_cache[str(global_offset + i)] = rec
        else:
            codigos = [parse_filename_parts(Path(f).name)[0] for f in chunk_files]
            db_cache = lookup_fn(codigos)

    tasks: list[tuple[str, Path, bool]] = []
    for idx, fpath in enumerate(chunk_files):
        p = Path(fpath)
        is_video_file = es_video(p)
        if engine:
            if mapping_index:
                if mapping_index.lookup(p.name) is not None:
                    nuevo_nombre = engine.aplicar(p, file_mapping=mapping_index)
                else:
                    nuevo_nombre = p.name
            elif key_column:
                codigo, seq = parse_filename_parts(p.name)
                stem = p.stem
                # Intentamos buscar por el código parseado o por el stem completo
                datos = db_cache.get(codigo) or db_cache.get(stem)
                if datos:
                    fseq = seq if use_filename_seq else None
                    nuevo_nombre = engine.aplicar(p, datos_bd=datos, codigo_manual=codigo, file_seq=fseq)
                else:
                    nuevo_nombre = p.name
            elif use_column_rename:
                codigo, seq = parse_filename_parts(p.name)
                datos = db_cache.get(str(global_offset + idx))
                fseq = seq if use_filename_seq else None
                nuevo_nombre = engine.aplicar(p, datos_bd=datos, codigo_manual=codigo, file_seq=fseq)
            else:
                codigo, seq = parse_filename_parts(p.name)
                datos = db_cache.get(codigo)
                fseq = seq if use_filename_seq else None
                nuevo_nombre = engine.aplicar(p, datos_bd=datos, codigo_manual=codigo, file_seq=fseq)
            if is_video_file or not conversion_enabled:
                out_path = Path(destino) / nuevo_nombre
            else:
                out_path = (Path(destino) / nuevo_nombre).with_suffix(ext_dest)
        else:
            out_path = Path(destino) / p.name if is_video_file or not conversion_enabled else Path(destino) / (p.stem + ext_dest)
        tasks.append((fpath, out_path, is_video_file))
    return tasks
