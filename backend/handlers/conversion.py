"""Conversion process handlers: preview, start, status, cancel.

Supports concurrent jobs via JobManager while maintaining backward compatibility
with the legacy single-job frontend API.

See backend/core/jobs.py for the full explanation of the legacy layer.
"""
from __future__ import annotations

import contextlib
import time
from collections.abc import Callable
from concurrent.futures import ALL_COMPLETED, CancelledError, wait
from pathlib import Path
from typing import Any, cast

from backend.core.converter import FORMATOS_SOPORTADOS, convertir_imagen, copiar_archivo, es_video
from backend.core.jobs import (
    Job,
    get_job_manager,
    is_legacy_default_job,
    resolve_job_id,
)
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

_CANCEL_GRACE_SECONDS = 0.25

_SEQUENCE_MODES = {"record", "global", "filename"}


@contextlib.contextmanager
def _engine_snapshot(engine: RenamerEngine):
    """Guarda y restaura ``engine.secuencia`` y ``engine._record_sequences``.

    Los previews de catálogo aplican renombres directamente (sin pasar por
    ``engine.preview_lote``, que ya restaura su propio estado), así que deben
    aislar los cambios para no alterar el contador del engine entre llamadas.
    """
    seq_backup = engine.secuencia
    record_sequences_backup = engine._record_sequences.copy()
    try:
        yield
    finally:
        engine.secuencia = seq_backup
        engine._record_sequences = record_sequences_backup


def _resolve_sequence_mode(params: dict[str, Any]) -> SequenceMode:
    """Resuelve el modo de secuencia explícito o hereda del booleano legacy."""
    requested = params.get("sequence_mode")
    if isinstance(requested, str) and requested in _SEQUENCE_MODES:
        return cast(SequenceMode, requested)
    return "filename" if params.get("use_filename_seq", True) else "global"


def _record_group_key(datos: dict[str, Any] | None, key_column: str, fallback: str) -> str:
    """Calcula la clave estable de fila usada por el modo ``record``."""
    raw_value = datos.get(key_column) if key_column and datos else None
    value = str(raw_value or fallback).strip()
    return value.casefold()


def _apply_catalog_rename(
    engine: RenamerEngine,
    path: str | Path,
    datos: dict[str, Any] | None,
    codigo: str,
    parsed_sequence: str,
    key_column: str,
) -> str:
    """Aplica el renombrado con catálogo pasando el grupo de fila al motor."""
    return engine.aplicar(
        path,
        datos_bd=datos,
        codigo_manual=codigo,
        file_seq=parsed_sequence,
        sequence_group=_record_group_key(datos, key_column, codigo),
    )


def _resolve_catalog_datos(
    f: str,
    *,
    db_cache: dict[str, dict[str, Any]] | None,
    db_records: list[dict[str, Any]] | None,
    index: int,
    code: str,
) -> dict[str, Any] | None:
    """Resuelve los datos de catálogo para un archivo.

    ``db_cache`` (búsqueda por código/stem) y ``db_records`` (índice posicional)
    son mutuamente exclusivos: pasar uno solo.
    """
    if db_records is not None:
        return db_records[index] if index < len(db_records) else None
    if db_cache is not None:
        return db_cache.get(code) or db_cache.get(Path(f).stem)
    return None


def _preview_with_db(
    engine: RenamerEngine,
    files: list[str],
    codigos_manuales: dict[str, str],
    file_seqs: dict[str, str],
    *,
    db_cache: dict[str, dict[str, Any]] | None,
    db_records: list[dict[str, Any]] | None,
    key_column: str,
) -> list[tuple[str, str, bool]]:
    """Aplica el renombre con catálogo a ``files`` dentro de un snapshot del engine."""
    resultados: list[tuple[str, str, bool]] = []
    with _engine_snapshot(engine):
        for index, f in enumerate(files):
            p = Path(f)
            code = codigos_manuales[p.name]
            datos = _resolve_catalog_datos(
                f,
                db_cache=db_cache,
                db_records=db_records,
                index=index,
                code=code,
            )
            if datos:
                nombre_nuevo = _apply_catalog_rename(
                    engine, f, datos, code, file_seqs[p.name], key_column
                )
                resultados.append((f, nombre_nuevo, True))
            else:
                resultados.append((f, p.name, False))
    return resultados


def _probe_key_columns(
    files: list[str],
    columns: list[str],
    sample_size: int = 30,
) -> tuple[str, int, list[tuple[str, int]], bool]:
    """Shared core of key-column auto-detection.

    Parses a sample of files into search keys (parsed codes + full stems),
    then counts ``buscar_por_columna`` matches per column. Exceptions become
    -1 so a broken column never wins. Returns ``(best_col, best_count,
    per_column_counts, had_search_keys)``; ``best_col`` is ``columns[0]``
    when nothing parses or every probe fails.
    """
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
) -> str:
    """Resolve the effective key column, auto-detecting if needed.

    Always probes all DB columns and picks the one with the most file-code
    matches. This fixes the case where the user's provided key_column is a
    valid column name but doesn't contain the file codes (e.g. 'nis' when
    the codes are actually in 'sgio').

    When ``key_column`` is falsy (auto-detect mode) the user-preference rule
    is skipped and the best-scoring column is returned — this is the
    behaviour ``_detect_best_key_column`` relies on.
    """
    from backend.core.config_fields import get_field_names

    columns = db_columns if db_columns is not None else get_field_names()
    if not columns:
        return key_column  # type: ignore[return-value]
    if len(columns) == 1:
        return columns[0]

    best_col, best_count, per_column, had_keys = _probe_key_columns(
        files, columns, sample_size=sample_size
    )
    if not had_keys:
        return best_col
    # Keep the user's choice if it matches equally well as the best
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
    """Auto-detect which DB column contains the file codes.

    Tries each column and picks the one with the most matches against the
    file codes (parsed stems). This fixes the common case where the user's
    file codes live in a column that is NOT the first one (e.g. 'sgio'
    instead of 'nis'), which caused silent rename failures because
    buscar_por_columna found nothing in the wrong column.

    Returns:
        Best matching column name, or the first column if none match.
        Empty string when there are no DB columns to probe.
    """
    if not db_columns:
        return ""
    return _resolve_key_column(None, files, db_columns, sample_size=sample_size)


@with_locale
@validate_params("files")
def preview(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    from backend.core.database import buscar_lote_por_codigos, buscar_por_columna, obtener_todos

    files = params.get("files", [])
    patron = params.get("patron", "")
    secuencia = params.get("secuencia", 1)
    use_column_rename = params.get("use_column_rename", False)
    key_column = params.get("key_column", "")
    file_mapping = params.get("mapping") or None
    # Precedence: inline mapping > mapping_path + columns > key_column.
    # When mapping_path is provided without inline mapping, parse the Excel
    # using the (optionally) chosen id/rename columns.
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
    codigos_list = []
    stems = []
    for f in files:
        p = Path(f)
        code, seq = parse_filename_parts(p.name)
        codigos_manuales[p.name] = code
        codigos_list.append(code)
        stems.append(p.stem)
        file_seqs[p.name] = seq

    collisions: list[dict[str, Any]] = []
    res: list[tuple[str, str, bool]] = []
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
        # Auto-detect the best key column if the provided one is invalid
        from backend.core.config_fields import get_field_names

        resolved_key = _resolve_key_column(key_column, files, get_field_names())
        if resolved_key != key_column:
            log_message(
                f"Columna ID '{key_column}' no encontrada en BD, usando '{resolved_key}'",
                "warn",
            )
        key_column = resolved_key
        # Buscamos por código parseado y por stem completo para máxima compatibilidad
        db_cache = buscar_por_columna(list(set(codigos_list + stems)), key_column)
        res = _preview_with_db(
            engine,
            files,
            codigos_manuales,
            file_seqs,
            db_cache=db_cache,
            db_records=None,
            key_column=key_column,
        )
    elif use_column_rename:
        db_records = obtener_todos(limit=len(files))
        res = _preview_with_db(
            engine,
            files,
            codigos_manuales,
            file_seqs,
            db_cache=None,
            db_records=db_records,
            key_column="",
        )
    else:
        # No key_column provided: try auto-detecting the best column first
        from backend.core.config_fields import get_field_names

        db_cols = get_field_names()
        auto_key = _detect_best_key_column(files, db_cols) if (db_cols and files) else ""
        if auto_key:
            db_cache = buscar_por_columna(list(set(codigos_list + stems)), auto_key)
            res = _preview_with_db(
                engine,
                files,
                codigos_manuales,
                file_seqs,
                db_cache=db_cache,
                db_records=None,
                key_column=auto_key,
            )
        else:
            db_cache = buscar_lote_por_codigos(codigos_list)
            def lookup(codigo: str) -> dict[str, Any] | None:
                return db_cache.get(codigo)
            sequence_groups = {}
            for f in files:
                name = Path(f).name
                code = codigos_manuales[name]
                datos = db_cache.get(code)
                if datos:
                    sequence_groups[name] = _record_group_key(datos, "", code)
            res = engine.preview_lote(
                files,
                lookup_fn=lookup,
                codigos_manuales=codigos_manuales,
                file_seqs=file_seqs,
                sequence_groups=sequence_groups,
            )

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
        job = mgr.get_job(job_id)
        log_message(t("info.process_cancelled"), "warn", state=job.state if job else None)
    return result


@with_locale
def preview_image(params: dict[str, Any]) -> dict[str, str]:
    from backend.core.converter import convertir_a_preview
    # Coerción defensiva en el boundary: el frontend puede enviar calidad como
    # string ("85") o path/formato como no-str, lo que rompería el core.
    calidad = params.get("calidad", 85)
    try:
        calidad = int(calidad)
    except (TypeError, ValueError):
        calidad = 85
    return convertir_a_preview(
        str(params.get("path") or ""),
        str(params.get("formato") or "PNG"),
        calidad,
        params.get("resize"),
    )


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
        word_separator = params.get("word_separator", "_")
        use_column_rename = params.get("use_column_rename", False)
        key_column = params.get("key_column", "")
        file_mapping = params.get("mapping") or None
        mapping_path = params.get("mapping_path") or ""
        mapping_id_column = params.get("id_column") or None
        mapping_rename_column = params.get("rename_column") or None
        mapping_index = None

        # Auto-detect the best key column if rename is enabled without mapping
        # and the provided key_column is empty or not in the DB schema.
        # Only run auto-detection when key_column is explicitly provided to
        # preserve the legacy fallback path (buscar_lote_por_codigos) that
        # matches across all fields.
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
                if is_video_file or not conversion_enabled:
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
        futures: list = []
        # Track output paths across chunks so same-name collisions never overwrite.
        reserved_out_paths: set[str] = set()

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
                    lookup_fn=buscar_lote_por_codigos,
                    use_column_rename=use_column_rename,
                    global_offset=chunk_start,
                    key_column=key_column,
                    mapping_index=mapping_index,
                )
                chunk_tasks = _dedupe_chunk_out_paths(
                    chunk_tasks,
                    reserved_out_paths,
                    log=lambda msg: log_message(msg, "warn", state=state),
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
        _notify_complete(job, ok_count, err_count)

        from backend.core.history import save_run
        rename_source = "mapping" if mapping_index else ("catalog" if key_column else "none")
        sequence_mode = _resolve_sequence_mode(params)
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
                "id_column": mapping_id_column or None,
                "rename_column": mapping_rename_column or None,
                "key_column": key_column or None,
                # Restored by History → Reejecutar so conversion matches the original run.
                "destino": destino or None,
                "secuencia": secuencia,
                "word_separator": word_separator,
                "use_filename_seq": params.get("use_filename_seq", True),
                "sequence_mode": sequence_mode,
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


def _notify_complete(job: Job, ok_count: int, err_count: int) -> None:
    """Send modern job complete notification + legacy one when needed."""
    is_default = is_legacy_default_job(job.id)
    notif_data = {"ok_count": ok_count, "err_count": err_count, "job_id": job.id}
    send_notification(f"job.{job.id}.complete", notif_data)
    if is_default:
        send_notification("process.complete", {"ok_count": ok_count, "err_count": err_count})


@with_locale
@validate_params("files")
def db_detect_key_column(params: dict[str, Any]) -> dict[str, Any]:
    """Auto-detect the DB column that best matches the file codes.

    Probes each configured DB column against the parsed file codes and
    returns the column with the most matches. This lets the frontend
    pick the right key column without the user having to guess.

    Returns:
        Dict with:
        - key_column: best matching column name (or first column if no match)
        - matches: number of matched files in the best column
        - columns: all probed columns with their match counts
    """
    files = params.get("files", [])
    if not files or not isinstance(files, list):
        return {"key_column": "", "matches": 0, "columns": []}

    from backend.core.config_fields import get_field_names

    db_cols = get_field_names()
    if not db_cols:
        return {"key_column": "", "matches": 0, "columns": []}

    if len(db_cols) == 1:
        return {"key_column": db_cols[0], "matches": 0, "columns": [{"name": db_cols[0], "matches": 0}]}

    best_col, best_count, per_column, had_keys = _probe_key_columns(files, db_cols)
    if not had_keys:
        return {"key_column": best_col, "matches": 0, "columns": []}
    return {
        "key_column": best_col,
        "matches": best_count,
        "columns": [{"name": col, "matches": count} for col, count in per_column],
    }


HANDLERS = {
    "preview": preview,
    "process_start": process_start,
    "process_status": process_status,
    "process_cancel": process_cancel,
    "preview_image": preview_image,
    "is_video": is_video,
    "db_detect_key_column": db_detect_key_column,
}


def _calculate_chunk_size() -> int:
    """Choose an adaptive chunk size without materializing the full batch."""
    if psutil is not None:
        try:
            available_gb = psutil.virtual_memory().available / (1024 ** 3)
            target_ram_per_chunk = available_gb * 0.25
            chunk_size = int((target_ram_per_chunk * 1024) / 5)
            return max(50, min(chunk_size, 1000))
        except Exception:
            return 500
    return 500


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
                nuevo_nombre = _apply_catalog_rename(engine, p, datos, codigo, seq, key_column) if datos else p.name
            elif use_column_rename:
                codigo, seq = parse_filename_parts(p.name)
                datos = db_cache.get(str(global_offset + idx))
                nuevo_nombre = _apply_catalog_rename(engine, p, datos, codigo, seq, "") if datos else p.name
            else:
                codigo, seq = parse_filename_parts(p.name)
                datos = db_cache.get(codigo)
                nuevo_nombre = _apply_catalog_rename(engine, p, datos, codigo, seq, "") if datos else p.name
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
    """Normalize output paths for collision detection (Windows-safe)."""
    return str(path).replace("\\", "/").casefold()


def _dedupe_chunk_out_paths(
    tasks: list[tuple[str, Path, bool]],
    reserved: set[str],
    *,
    log: Callable[[str], None] | None = None,
) -> list[tuple[str, Path, bool]]:
    """Ensure each task writes to a unique path within the batch.

    Mapping mode already fails the job on collisions; catalog / plain rename can
    still map two inputs to the same destination and silently overwrite. Auto-suffix
    (``name-2.ext``) preserves both files without changing unique renames.
    """
    if not tasks:
        return tasks

    result: list[tuple[str, Path, bool]] = []
    for fpath, out_path, is_video_file in tasks:
        key = _out_path_key(out_path)
        if key not in reserved:
            reserved.add(key)
            result.append((fpath, out_path, is_video_file))
            continue

        stem = out_path.stem
        suffix = out_path.suffix
        parent = out_path.parent
        n = 2
        candidate = parent / f"{stem}-{n}{suffix}"
        while _out_path_key(candidate) in reserved:
            n += 1
            candidate = parent / f"{stem}-{n}{suffix}"
        reserved.add(_out_path_key(candidate))
        if log is not None:
            log(
                f"Colisión de salida: '{out_path.name}' ya reservado; "
                f"'{Path(fpath).name}' se guardará como '{candidate.name}'"
            )
        result.append((fpath, candidate, is_video_file))
    return result
