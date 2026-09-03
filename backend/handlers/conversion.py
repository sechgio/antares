from __future__ import annotations

import contextlib
import logging
import os
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable
from concurrent.futures import ALL_COMPLETED, CancelledError, Future, as_completed, wait
from pathlib import Path
from typing import Any, cast

from backend.core.converter import FORMATOS_SOPORTADOS, convertir_imagen, copiar_archivo, es_video
from backend.core.jobs import (
    Job,
    get_job_manager,
    is_legacy_default_job,
    resolve_job_id,
)
from backend.core.naming import RenamePlan, resolve_rename_plan
from backend.core.renamer import RenamerEngine, SequenceMode
from backend.core.scheduler import get_scheduler
from backend.handlers.common import log_message, validate_params, with_locale
from backend.ipc_protocol import send_notification
from backend.utils.i18n import set_locale, t
from backend.utils.validators import parse_filename_parts

try:
    import psutil
except ImportError:
    psutil = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

_CANCEL_GRACE_SECONDS = 0.25
_HEARTBEAT_INTERVAL_SECONDS = 15.0

_SEQUENCE_MODES = {"record", "global", "filename"}


@contextlib.contextmanager
def _engine_snapshot(engine: RenamerEngine):
    seq_backup = engine.secuencia
    record_sequences_backup = engine._record_sequences.copy()
    try:
        yield
    finally:
        engine.secuencia = seq_backup
        engine._record_sequences = record_sequences_backup


def _resolve_sequence_mode(params: dict[str, Any]) -> SequenceMode:
    requested = params.get("sequence_mode")
    if isinstance(requested, str) and requested in _SEQUENCE_MODES:
        return cast(SequenceMode, requested)
    return "filename" if params.get("use_filename_seq", True) else "global"


def _probe_key_columns(
    files: list[str],
    columns: list[str],
    sample_size: int = 30,
) -> tuple[str, int, list[tuple[str, int]], bool]:
    from backend.core.database import buscar_por_columna

    sample_files = files[:sample_size]
    codigos: list[str] = []
    stems: list[str] = []
    for f in sample_files:
        p = Path(f)
        code, _ = parse_filename_parts(p.name)
        codigos.append(code)
        stems.append(p.stem)
    search_keys = list(set(codigos + stems))
    if not search_keys:
        return columns[0], -1, [], False

    best_col = columns[0]
    best_count = -1
    per_column: list[tuple[str, int]] = []
    for col in columns:
        try:
            count = len(buscar_por_columna(search_keys, col))
        except Exception:
            count = -1
        per_column.append((col, count))
        if count > best_count:
            best_count = count
            best_col = col
    return best_col, best_count, per_column, True


def _resolve_key_column(
    key_column: str | None,
    files: list[str],
    db_columns: list[str] | None = None,
    *,
    sample_size: int = 30,
    probe_result: tuple[str, int, list[tuple[str, int]], bool] | None = None,
) -> str:
    from backend.core.config_fields import get_field_names

    columns = db_columns if db_columns is not None else get_field_names()
    if not columns:
        return key_column  # type: ignore[return-value]
    if len(columns) == 1:
        return columns[0]

    if probe_result is None:
        probe_result = _probe_key_columns(files, columns, sample_size=sample_size)
    best_col, best_count, per_column, had_keys = probe_result
    if not had_keys:
        return best_col
    if key_column and key_column in columns:
        user_count = dict(per_column).get(key_column, -1)
        if user_count >= 0 and user_count >= best_count and user_count > 0:
            return key_column
    return best_col


def _detect_best_key_column(
    files: list[str],
    db_columns: list[str],
    sample_size: int = 30,
) -> str:
    if not db_columns:
        return ""
    return _resolve_key_column(None, files, db_columns, sample_size=sample_size)


def _preview_detect_fields(
    files: list[str],
    db_cols: list[str],
) -> tuple[dict[str, Any], tuple[str, int, list[tuple[str, int]], bool] | None]:
    if len(db_cols) <= 1:
        return {}, None
    probe = _probe_key_columns(files, db_cols)
    best_col, best_count, _, had_keys = probe
    if not had_keys:
        return {"detected_key_column": best_col, "detected_key_column_matches": 0}, probe
    return {
        "detected_key_column": best_col,
        "detected_key_column_matches": best_count,
    }, probe


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
    file_mapping = params.get("mapping") or None
    if not file_mapping and params.get("mapping_path"):
        from backend.core.database import parse_id_rename_mapping

        mapping_path = params.get("mapping_path") or ""
        file_mapping = parse_id_rename_mapping(
            mapping_path,
            id_column=params.get("id_column") or None,
            rename_column=params.get("rename_column") or None,
        )
    word_separator = params.get("word_separator", "_")
    sequence_mode = _resolve_sequence_mode(params)
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
        detect_fields, probe = _preview_detect_fields(files, db_cols) if db_cols else ({}, None)
        resolved_key = _resolve_key_column(key_column, files, db_cols, probe_result=probe)
        if resolved_key != key_column:
            log_message(
                f"Columna ID '{key_column}' no encontrada en BD, usando '{resolved_key}'",
                "warn",
            )
        key_column = resolved_key
        with _engine_snapshot(engine):
            plan = resolve_rename_plan(files, engine, key_column=key_column)
        res = plan.items
    elif use_column_rename:
        with _engine_snapshot(engine):
            plan = resolve_rename_plan(files, engine, use_column_rename=True)
        res = plan.items
    else:
        with _engine_snapshot(engine):
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
        disk_keys = _scan_dest_out_keys(destino) if destino else set()
        dest_base = Path(destino) if destino else None
        fake_tasks = [
            (orig, (dest_base / nuev) if dest_base else Path(nuev), False)
            for orig, nuev, _en_bd in res
        ]
        deduped = _dedupe_chunk_out_paths(fake_tasks, reserved_preview, disk_keys=disk_keys)
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


def _run_conversion_job(job: Job) -> None:
    from backend.core.database import buscar_lote_por_codigos

    state = job.state
    params = job.params
    job_id = job.id
    is_default = is_legacy_default_job(job_id)
    notified = False

    stop_heartbeat = threading.Event()
    heartbeat_thread: threading.Thread | None = None

    def _heartbeat_loop() -> None:
        while not stop_heartbeat.wait(_HEARTBEAT_INTERVAL_SECONDS):
            with state._lock:
                if not state.running:
                    break
            _emit_heartbeat(job_id, is_default)

    try:
        try:
            heartbeat_thread = threading.Thread(
                target=_heartbeat_loop,
                name=f"job-heartbeat-{job_id}",
                daemon=True,
            )
            heartbeat_thread.start()
            _emit_heartbeat(job_id, is_default)

            set_locale(params.get("locale", "es"))
            job_t0 = time.perf_counter()
            files = params.get("files", [])
            destino = params.get("destino", "")
            formato = params.get("formato", "JPEG")
            calidad = params.get("calidad", 95)
            optimize_jpeg = bool(params.get("optimize_jpeg", False))
            conversion_enabled = params.get("conversion_enabled", True)
            resize_ancho = params.get("resize_ancho")
            resize_alto = params.get("resize_alto")
            keep_exif = params.get("keep_exif", False)
            usar_rename = params.get("usar_rename", True)
            patron = params.get("patron", "")
            secuencia = params.get("secuencia", 1)
            word_separator = params.get("word_separator", "_")
            use_column_rename = params.get("use_column_rename", False)
            key_column = params.get("key_column", "")
            file_mapping = params.get("mapping") or None
            mapping_path = params.get("mapping_path") or ""
            mapping_id_column = params.get("id_column") or None
            mapping_rename_column = params.get("rename_column") or None
            mapping_index = None

            if usar_rename and not file_mapping and not mapping_path and files and key_column:
                from backend.core.config_fields import get_field_names

                db_cols = get_field_names()
                if db_cols:
                    original_key = key_column
                    key_column = _resolve_key_column(key_column, files, db_cols)
                    if key_column != original_key:
                        log_message(
                            f"Columna ID auto-detectada: '{key_column}' "
                            f"(original: '{original_key or '(vacío)'}')",
                            "info",
                            state=state,
                        )

            if mapping_path and not file_mapping:
                from backend.core.database import parse_id_rename_mapping

                file_mapping = parse_id_rename_mapping(
                    mapping_path,
                    id_column=mapping_id_column,
                    rename_column=mapping_rename_column,
                )

            if file_mapping is not None:
                if not isinstance(file_mapping, dict) or len(file_mapping) == 0:
                    log_message("El mapeo de renombrado está vacío o es inválido", "error", state=state)
                    _notify_complete(job, 0, len(params.get("files", [])))
                    notified = True
                    return
                for _key, value in file_mapping.items():
                    if not isinstance(value, str) or not value.strip():
                        log_message("El mapeo contiene valores de RENOMBRE vacíos o inválidos", "error", state=state)
                        _notify_complete(job, 0, len(params.get("files", [])))
                        notified = True
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
                    notified = True
                    return
                log_message(f"Modo: Renombrado por mapeo directo ({len(file_mapping)} entradas)", "info", state=state)

            engine = (
                RenamerEngine(
                    patron,
                    secuencia,
                    separador=word_separator,
                    sequence_mode=_resolve_sequence_mode(params),
                )
                if usar_rename
                else None
            )
            try:
                rw = int(resize_ancho) if resize_ancho is not None else None
                rh = int(resize_alto) if resize_alto is not None else None
                resize = (rw, rh) if rw and rh and rw > 0 and rh > 0 else None
            except (ValueError, TypeError):
                resize = None

            if conversion_enabled and formato not in FORMATOS_SOPORTADOS:
                log_message(f"Formato no soportado: {formato}", "error", state=state)
                _notify_complete(job, 0, len(files))
                notified = True
                return

            ext_dest = FORMATOS_SOPORTADOS[formato]["ext"] if conversion_enabled else None
            total = len(files)

            ensure_dir_per_file = True
            if destino:
                try:
                    Path(destino).mkdir(parents=True, exist_ok=True)
                    ensure_dir_per_file = False
                except OSError:
                    logger.debug(
                        "Could not pre-create destino=%s; using per-file ensure_dir",
                        destino,
                        exc_info=True,
                    )
            disk_out_keys: set[str] | None = _scan_dest_out_keys(destino) if destino else set()

            completed = 0

            def _process_one(task: tuple[str, Path, bool]) -> tuple[bool, str, str]:
                fpath, out_path, is_video_file = task
                p = Path(fpath)
                try:
                    with state._lock:
                        if state.cancel_requested:
                            raise CancelledError()
                    if is_video_file or not conversion_enabled:
                        copiar_archivo(fpath, out_path, ensure_dir=ensure_dir_per_file)
                    else:
                        convertir_imagen(
                            fpath,
                            out_path,
                            formato,
                            calidad,
                            resize,
                            keep_exif,
                            optimize=optimize_jpeg,
                            ensure_dir=ensure_dir_per_file,
                        )
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
            futures: list = []
            reserved_out_paths: set[str] = set()
            prefetched_raw: list[tuple[str, Path, bool]] | None = None
            prefetched_for_start: int | None = None
            submit_light = getattr(scheduler, "submit_light", None)
            max_in_flight = max(1, int(getattr(scheduler, "heavy_capacity", 8) or 8))

            def _warn_dedupe(msg: str) -> None:
                log_message(msg, "warn", state=state)

            def _prepare_chunk_raw(chunk_files: list[str], global_offset: int) -> list[tuple[str, Path, bool]]:
                return _prepare_chunk_tasks(
                    chunk_files,
                    destino=destino,
                    engine=engine,
                    conversion_enabled=conversion_enabled,
                    ext_dest=ext_dest,
                    lookup_fn=buscar_lote_por_codigos,
                    use_column_rename=use_column_rename,
                    global_offset=global_offset,
                    key_column=key_column,
                    mapping_index=mapping_index,
                )

            def _handle_completion(success: bool, name: str, error: str) -> None:
                nonlocal completed, cancelled, _last_notify_time
                with state._lock:
                    if state.cancel_requested:
                        cancelled = True
                        return
                completed += 1
                with state._lock:
                    if success:
                        state.ok_count += 1
                        log_message(
                            f"{'Renombrado' if not conversion_enabled else 'Procesado'}: {name}",
                            "ok",
                            state=state,
                        )
                    else:
                        state.err_count += 1
                        log_message(
                            t("error.process_failed", file=name, error=error),
                            "error",
                            state=state,
                        )
                    state.progress = int((completed / total) * 100)
                    state.current_file = name
                    progress = state.progress
                    current_file = state.current_file
                    ok_count = state.ok_count
                    err_count = state.err_count

                now = time.time()
                is_last = completed == total
                should_notify = (
                    is_last
                    or _last_notify_time == 0.0
                    or (now - _last_notify_time >= _NOTIFY_INTERVAL)
                )
                if should_notify:
                    _last_notify_time = now
                    notif_data = {
                        "progress": progress,
                        "current_file": current_file,
                        "ok_count": ok_count,
                        "err_count": err_count,
                        "job_id": job_id,
                    }
                    _emit_progress_notifications(job_id, notif_data, is_default)

                with state._lock:
                    if state.cancel_requested and not cancelled:
                        cancelled = True
                        log_message(t("info.process_cancelled"), "warn", state=state)

            try:
                for chunk_start in range(0, len(files), CHUNK_SIZE):
                    if cancelled:
                        break
                    chunk_end = min(chunk_start + CHUNK_SIZE, len(files))
                    chunk_files = files[chunk_start:chunk_end]

                    if prefetched_raw is not None and prefetched_for_start == chunk_start:
                        raw_tasks = prefetched_raw
                        prefetched_raw = None
                        prefetched_for_start = None
                    else:
                        raw_tasks = _prepare_chunk_raw(chunk_files, chunk_start)

                    chunk_tasks = _dedupe_chunk_out_paths(
                        raw_tasks,
                        reserved_out_paths,
                        job_id=job_id,
                        log=_warn_dedupe,
                        disk_keys=disk_out_keys,
                    )

                    task_queue = deque(chunk_tasks)
                    in_flight: dict[Future, None] = {}
                    futures = []

                    def _submit_one(
                        _task_queue: deque = task_queue,
                        _in_flight: dict[Future, None] = in_flight,
                        _futures: list = futures,
                    ) -> bool:
                        nonlocal cancelled
                        if not _task_queue:
                            return True
                        task = _task_queue.popleft()
                        future = scheduler.submit_heavy(
                            _process_one,
                            task,
                            block=True,
                            cancel_check=lambda: state.cancel_requested,
                        )
                        if future is None:
                            cancelled = True
                            return False
                        _in_flight[future] = None
                        _futures.append(future)
                        return True

                    while len(in_flight) < max_in_flight and task_queue:
                        if not _submit_one():
                            break

                    if cancelled:
                        for future in list(in_flight):
                            future.cancel()
                        wait(list(in_flight), timeout=_CANCEL_GRACE_SECONDS, return_when=ALL_COMPLETED)
                        break

                    with state._lock:
                        if state.cancel_requested:
                            cancelled = True
                            log_message(t("info.process_cancelled"), "warn", state=state)
                    if cancelled:
                        for future in list(in_flight):
                            future.cancel()
                        wait(list(in_flight), timeout=_CANCEL_GRACE_SECONDS, return_when=ALL_COMPLETED)
                        break

                    next_start = chunk_start + CHUNK_SIZE
                    prefetch_future: Future | None = None
                    if submit_light is not None and next_start < len(files):
                        next_end = min(next_start + CHUNK_SIZE, len(files))
                        next_files = files[next_start:next_end]
                        try:
                            prefetch_future = submit_light(
                                _prepare_chunk_raw,
                                next_files,
                                next_start,
                            )
                        except Exception:
                            logger.debug("Chunk prefetch submit_light failed; will prepare sync", exc_info=True)
                            prefetch_future = None

                    while in_flight:
                        if all(isinstance(f, Future) for f in in_flight):
                            done_fut = next(as_completed(list(in_flight.keys())))
                        else:
                            done_fut = next(iter(in_flight))
                        in_flight.pop(done_fut, None)
                        if not done_fut.cancelled():
                            try:
                                success, name, error = done_fut.result()
                            except CancelledError:
                                pass
                            else:
                                _handle_completion(success, name, error)

                        with state._lock:
                            if state.cancel_requested:
                                cancelled = True

                        if cancelled:
                            for pending in list(in_flight):
                                pending.cancel()
                            task_queue.clear()
                            break

                        while len(in_flight) < max_in_flight and task_queue and not cancelled:
                            if not _submit_one():
                                break

                        if cancelled:
                            for pending in list(in_flight):
                                pending.cancel()
                            task_queue.clear()
                            break

                    if prefetch_future is not None:
                        try:
                            raw_next = prefetch_future.result()
                        except Exception:
                            logger.debug("Chunk prefetch prepare failed; will prepare sync", exc_info=True)
                            raw_next = None
                        with state._lock:
                            if state.cancel_requested:
                                cancelled = True
                        if cancelled or raw_next is None:
                            prefetched_raw = None
                            prefetched_for_start = None
                        else:
                            prefetched_raw = raw_next
                            prefetched_for_start = next_start
            finally:
                if cancelled:
                    wait(futures, timeout=_CANCEL_GRACE_SECONDS, return_when=ALL_COMPLETED)

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
            with state._lock:
                final_progress = state.progress
            _notify_complete(job, ok_count, err_count, cancelled=cancelled, progress=final_progress)
            notified = True

            from backend.core.history import save_run
            rename_source = "mapping" if mapping_index else ("catalog" if key_column else "none")
            sequence_mode = _resolve_sequence_mode(params)
            duration_ms = int((time.perf_counter() - job_t0) * 1000)
            try:
                save_run(
                    files=[str(f) for f in files],
                    options={
                        "formato": formato,
                        "calidad": calidad,
                        "optimize_jpeg": optimize_jpeg,
                        "conversion_enabled": conversion_enabled,
                        "resize": str(resize) if resize else None,
                        "keep_exif": keep_exif,
                        "usar_rename": usar_rename,
                        "use_column_rename": use_column_rename,
                        "rename_source": rename_source,
                        "mapping_mode": mapping_index is not None,
                        "mapping_path": mapping_path or None,
                        "id_column": mapping_id_column or None,
                        "rename_column": mapping_rename_column or None,
                        "key_column": key_column or None,
                        "destino": destino or None,
                        "secuencia": secuencia,
                        "word_separator": word_separator,
                        "use_filename_seq": params.get("use_filename_seq", True),
                        "sequence_mode": sequence_mode,
                        "cancelled": cancelled,
                    },
                    patron=patron, formato=formato, calidad=calidad,
                    resize=str(resize) if resize else None, ok_count=ok_count, err_count=err_count,
                    duration_ms=duration_ms,
                )
            except Exception:
                logger.exception("Failed to save conversion history for job %s", job_id)
                log_message("No se pudo guardar el historial de la conversión", "warn", state=state)
        except Exception as exc:
            if not notified:
                files = params.get("files", []) or []
                err_count = len(files) if files else 1
                error_msg = f"{type(exc).__name__}: {exc}"
                logger.exception("Conversion job %s failed: %s", job_id, error_msg)
                log_message(error_msg, "error", state=state)
                with state._lock:
                    job.result = {
                        "ok_count": 0,
                        "err_count": err_count,
                        "cancelled": False,
                        "error": error_msg,
                    }
                _notify_complete(job, 0, err_count, cancelled=False, progress=0)
                notified = True
    finally:
        stop_heartbeat.set()
        if heartbeat_thread is not None:
            heartbeat_thread.join(timeout=1.0)
        with state._lock:
            state.running = False


def _emit_heartbeat(job_id: str, is_default: bool) -> None:
    payload = {"running": True, "job_id": job_id}
    send_notification(f"job.{job_id}.heartbeat", payload)
    if is_default:
        send_notification("process.heartbeat", payload)


def _emit_progress_notifications(job_id: str, data: dict[str, Any], is_default: bool) -> None:
    send_notification(f"job.{job_id}.progress", data)
    if is_default:
        send_notification("process.progress", {
            "progress": data["progress"],
            "current_file": data["current_file"],
            "ok_count": data["ok_count"],
            "err_count": data["err_count"],
        })


def _notify_complete(
    job: Job,
    ok_count: int,
    err_count: int,
    *,
    cancelled: bool = False,
    progress: int | None = None,
) -> None:
    is_default = is_legacy_default_job(job.id)
    final_progress = 100 if not cancelled else (progress if progress is not None else 0)
    notif_data = {
        "ok_count": ok_count,
        "err_count": err_count,
        "job_id": job.id,
        "cancelled": cancelled,
        "progress": final_progress,
    }
    send_notification(f"job.{job.id}.complete", notif_data)
    if is_default:
        send_notification(
            "process.complete",
            {
                "ok_count": ok_count,
                "err_count": err_count,
                "cancelled": cancelled,
                "progress": final_progress,
            },
        )


HANDLERS = {
    "preview": preview,
    "process_start": process_start,
    "process_status": process_status,
    "process_cancel": process_cancel,
    "is_video": is_video,
}


_dest_scan_cache: OrderedDict[str, tuple[float, set[str]]] = OrderedDict()
_dest_scan_lock = threading.Lock()
_MAX_DEST_SCAN_CACHE = 32
_MAX_DEST_SCAN_ENTRIES = 100_000


def _calculate_chunk_size() -> int:
    size = 500
    if psutil is not None:
        try:
            available_gb = psutil.virtual_memory().available / (1024 ** 3)
            target_ram_per_chunk = available_gb * 0.25
            chunk_size = int((target_ram_per_chunk * 1024) / 5)
            size = max(100, min(chunk_size, 1000))
        except Exception:
            size = 500
    try:
        cap = int(getattr(get_scheduler(), "heavy_capacity", 0) or 0)
        if cap > 0:
            size = min(size, max(100, cap * 6))
    except Exception:
        pass
    return size


def _scan_dest_out_keys(destino: str | Path) -> set[str] | None:
    dest = Path(destino)
    try:
        dir_mtime = dest.stat().st_mtime if dest.is_dir() else 0.0
        cache_key = str(dest.resolve()) if dest.is_dir() else str(dest)
        with _dest_scan_lock:
            cached = _dest_scan_cache.get(cache_key)
            if cached and cached[0] == dir_mtime:
                _dest_scan_cache.move_to_end(cache_key)
                return set(cached[1])
    except OSError:
        dir_mtime = 0.0
        cache_key = str(dest)
    keys: set[str] = set()
    try:
        with os.scandir(dest) as entries:
            for index, entry in enumerate(entries, start=1):
                if index > _MAX_DEST_SCAN_ENTRIES:
                    logger.debug(
                        "scandir entry cap reached for destino=%s; falling back to exists()",
                        dest,
                    )
                    return None
                keys.add(_out_path_key(dest / entry.name))
    except FileNotFoundError:
        pass
    except OSError:
        logger.debug("scandir failed for destino=%s; falling back to exists()", dest, exc_info=True)
        return None
    with _dest_scan_lock:
        _dest_scan_cache[cache_key] = (dir_mtime, set(keys))
        _dest_scan_cache.move_to_end(cache_key)
        while len(_dest_scan_cache) > _MAX_DEST_SCAN_CACHE:
            _dest_scan_cache.popitem(last=False)
    return keys


def _prepare_chunk_tasks(
    chunk_files: list[str],
    *,
    destino: str,
    engine: RenamerEngine | None,
    conversion_enabled: bool,
    ext_dest: str | None,
    lookup_fn,
    use_column_rename: bool = False,
    global_offset: int = 0,
    key_column: str = "",
    mapping_index: Any | None = None,
) -> list[tuple[str, Path, bool]]:
    plan: RenamePlan | None = None
    if engine and not mapping_index:
        plan = resolve_rename_plan(
            chunk_files,
            engine,
            key_column=key_column,
            use_column_rename=use_column_rename,
            global_offset=global_offset,
            lookup_batch=None if (key_column or use_column_rename) else lookup_fn,
        )

    tasks: list[tuple[str, Path, bool]] = []
    for idx, fpath in enumerate(chunk_files):
        p = Path(fpath)
        is_video_file = es_video(p)
        if engine:
            if mapping_index:
                if mapping_index.lookup(p.name) is not None:
                    nuevo_nombre = engine.aplicar(p, file_mapping=mapping_index)
                else:
                    nuevo_nombre = RenamerEngine._preserve_original_name(p)
            else:
                assert plan is not None
                nuevo_nombre = plan.items[idx][1]
            if is_video_file or not conversion_enabled:
                out_path = Path(destino) / nuevo_nombre
            else:
                assert ext_dest is not None
                out_path = (Path(destino) / nuevo_nombre).with_suffix(ext_dest)
        else:
            if is_video_file or not conversion_enabled:
                out_path = Path(destino) / p.name
            else:
                assert ext_dest is not None
                out_path = Path(destino) / (p.stem + ext_dest)
        tasks.append((fpath, out_path, is_video_file))
    return tasks


def _out_path_key(path: Path) -> str:
    return str(path).replace("\\", "/").casefold()


_MAX_OUT_PATH_DEDUP_ATTEMPTS = 10_000


def _claim_out_path(
    path: Path,
    reserved: set[str],
    *,
    job_id: str | None = None,
    disk_keys: set[str] | None = None,
) -> bool:
    key = _out_path_key(path)
    if key in reserved:
        return False
    if disk_keys is not None:
        if key in disk_keys:
            return False
    elif path.exists():
        return False
    if job_id is not None and not get_job_manager().try_reserve_out_path(job_id, key):
        return False
    reserved.add(key)
    if disk_keys is not None:
        disk_keys.add(key)
    return True


def _dedupe_chunk_out_paths(
    tasks: list[tuple[str, Path, bool]],
    reserved: set[str],
    *,
    job_id: str | None = None,
    log: Callable[[str], None] | None = None,
    disk_keys: set[str] | None = None,
) -> list[tuple[str, Path, bool]]:
    if not tasks:
        return tasks

    result: list[tuple[str, Path, bool]] = []
    for fpath, out_path, is_video_file in tasks:
        if _claim_out_path(out_path, reserved, job_id=job_id, disk_keys=disk_keys):
            result.append((fpath, out_path, is_video_file))
            continue

        stem = out_path.stem
        suffix = out_path.suffix
        parent = out_path.parent
        n = 2
        candidate = parent / f"{stem}-{n}{suffix}"
        attempts = 0
        claimed = False
        while attempts < _MAX_OUT_PATH_DEDUP_ATTEMPTS:
            if _claim_out_path(candidate, reserved, job_id=job_id, disk_keys=disk_keys):
                claimed = True
                break
            n += 1
            attempts += 1
            candidate = parent / f"{stem}-{n}{suffix}"
        if not claimed:
            key = _out_path_key(candidate)
            reserved.add(key)
            if disk_keys is not None:
                disk_keys.add(key)
            if job_id is not None:
                get_job_manager().try_reserve_out_path(job_id, key)
        if log is not None:
            reason = "ya existe en disco" if out_path.exists() else "ya reservado"
            log(
                f"Colisión de salida: '{out_path.name}' {reason}; "
                f"'{Path(fpath).name}' se guardará como '{candidate.name}'"
            )
        result.append((fpath, candidate, is_video_file))
    return result
