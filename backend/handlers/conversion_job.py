from __future__ import annotations

import contextlib
import logging
import threading
import time
from collections import deque
from collections.abc import Callable
from concurrent.futures import ALL_COMPLETED, CancelledError, Future, as_completed, wait
from pathlib import Path
from typing import Any

from backend.core import conversion_probe, out_path_dedupe
from backend.core.converter import FORMATOS_SOPORTADOS, convertir_imagen, copiar_archivo, es_video
from backend.core.jobs import Job, is_legacy_default_job
from backend.core.naming import RenamePlan, resolve_rename_plan
from backend.core.renamer import RenamerEngine
from backend.core.scheduler import get_scheduler
from backend.core.state import ProcessState, log_message
from backend.ipc_protocol import send_notification
from backend.utils.i18n import set_locale, t

try:
    import psutil
except ImportError:
    psutil = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

_CANCEL_GRACE_SECONDS = 0.25
_HEARTBEAT_INTERVAL_SECONDS = 15.0


def _run_conversion_job(job: Job) -> None:
    from backend.core.database import buscar_lote_por_codigos

    state = job.state
    params = job.params
    job_id = job.id
    is_default = is_legacy_default_job(job_id)
    notified = False

    try:
        with _heartbeat(job_id, state, is_default):
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
            file_mapping, mapping_path = conversion_probe._resolve_file_mapping(params)
            mapping_id_column = params.get("id_column") or None
            mapping_rename_column = params.get("rename_column") or None
            mapping_index = None

            if usar_rename and not file_mapping and not mapping_path and files and key_column:
                from backend.core.config_fields import get_field_names

                db_cols = get_field_names()
                if db_cols:
                    original_key = key_column
                    key_column = conversion_probe._resolve_key_column(key_column, files, db_cols)
                    if key_column != original_key:
                        log_message(
                            f"Columna ID auto-detectada: '{key_column}' "
                            f"(original: '{original_key or '(vacío)'}')",
                            "info",
                            state=state,
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
                    sequence_mode=conversion_probe._resolve_sequence_mode(params),
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
            disk_out_keys: set[str] | None = out_path_dedupe._scan_dest_out_keys(destino) if destino else set()

            completed = 0
            _last_notify_time = 0.0
            _NOTIFY_INTERVAL = 0.5

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
                nonlocal completed, _last_notify_time
                now = time.time()
                notif_data: dict[str, Any] | None = None
                is_last = False
                item_log: tuple[str, str] | None = None
                with state._lock:
                    if state.cancel_requested:
                        return
                    completed += 1
                    if success:
                        state.ok_count += 1
                        item_log = (
                            f"{'Renombrado' if not conversion_enabled else 'Procesado'}: {name}",
                            "ok",
                        )
                    else:
                        state.err_count += 1
                        item_log = (t("error.process_failed", file=name, error=error), "error")
                    state.progress = int((completed / total) * 100)
                    state.current_file = name
                    is_last = completed == total
                    should_notify = (
                        is_last
                        or _last_notify_time == 0.0
                        or (now - _last_notify_time >= _NOTIFY_INTERVAL)
                    )
                    if should_notify:
                        _last_notify_time = now
                        notif_data = {
                            "progress": state.progress,
                            "current_file": state.current_file,
                            "ok_count": state.ok_count,
                            "err_count": state.err_count,
                            "job_id": job_id,
                        }

                # log_message escribe en stderr: dentro del lock serializaría los
                # cierres de todos los workers detrás del pipe de logs.
                if item_log is not None:
                    log_message(item_log[0], item_log[1], state=state)

                if notif_data is not None:
                    _emit_progress_notifications(job_id, notif_data, is_default)

                with state._lock:
                    cancel_requested = state.cancel_requested
                if cancel_requested:
                    log_message(t("info.process_cancelled"), "warn", state=state)

            cancelled = _drive_chunk_loop(
                job,
                process_one=_process_one,
                prepare_chunk=_prepare_chunk_raw,
                handle_completion=_handle_completion,
                disk_out_keys=disk_out_keys,
            )

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

            rename_source = "mapping" if mapping_index else ("catalog" if key_column else "none")
            _record_run_history(
                job_id,
                state,
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
                    "sequence_mode": conversion_probe._resolve_sequence_mode(params),
                    "cancelled": cancelled,
                },
                patron=patron,
                formato=formato,
                calidad=calidad,
                resize=str(resize) if resize else None,
                ok_count=ok_count,
                err_count=err_count,
                duration_ms=int((time.perf_counter() - job_t0) * 1000),
            )
    except Exception as exc:
        if not notified:
            files = params.get("files", []) or []
            error_msg = f"{type(exc).__name__}: {exc}"
            logger.exception("Conversion job %s failed: %s", job_id, error_msg)
            log_message(error_msg, "error", state=state)
            with state._lock:
                ok_count = state.ok_count
                err_count = max(len(files) - ok_count, 1) if files else 1
                job.result = {
                    "ok_count": ok_count,
                    "err_count": err_count,
                    "cancelled": False,
                    "error": error_msg,
                }
            _notify_complete(job, ok_count, err_count, cancelled=False, progress=0)
            notified = True
    finally:
        with state._lock:
            state.running = False


def _drive_chunk_loop(
    job: Job,
    *,
    process_one: Callable[[tuple[str, Path, bool]], tuple[bool, str, str]],
    prepare_chunk: Callable[[list[str], int], list[tuple[str, Path, bool]]],
    handle_completion: Callable[[bool, str, str], None],
    disk_out_keys: set[str] | None,
) -> bool:
    """Consume `files` por chunks con prefetch solapado del siguiente chunk,
    límite de in-flight y cancelación cooperativa. Devuelve True si se canceló."""
    state = job.state
    job_id = job.id
    files = job.params.get("files", [])
    CHUNK_SIZE = _calculate_chunk_size()
    scheduler = get_scheduler()
    cancelled = False
    futures: list = []
    reserved_out_paths: set[str] = set()
    prefetched_raw: list[tuple[str, Path, bool]] | None = None
    prefetched_for_start: int | None = None
    submit_light = getattr(scheduler, "submit_light", None)
    max_in_flight = max(1, int(getattr(scheduler, "heavy_capacity", 8) or 8))

    def _warn_dedupe(msg: str) -> None:
        log_message(msg, "warn", state=state)

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
                raw_tasks = prepare_chunk(chunk_files, chunk_start)

            chunk_tasks = out_path_dedupe._dedupe_chunk_out_paths(
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
                    process_one,
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

            with state._lock:
                cancel_just_seen = state.cancel_requested and not cancelled
                if cancel_just_seen:
                    cancelled = True
            if cancel_just_seen:
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
                        prepare_chunk,
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
                        handle_completion(success, name, error)

                with state._lock:
                    if state.cancel_requested:
                        cancelled = True

                if not cancelled:
                    while len(in_flight) < max_in_flight and task_queue:
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

    return cancelled


@contextlib.contextmanager
def _heartbeat(job_id: str, state: ProcessState, is_default: bool):
    stop = threading.Event()

    def loop() -> None:
        while not stop.wait(_HEARTBEAT_INTERVAL_SECONDS):
            with state._lock:
                if not state.running:
                    return
            _emit_heartbeat(job_id, is_default)

    thread = threading.Thread(target=loop, name=f"job-heartbeat-{job_id}", daemon=True)
    thread.start()
    _emit_heartbeat(job_id, is_default)
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=1.0)


def _record_run_history(
    job_id: str,
    state: ProcessState,
    *,
    files: list[str],
    options: dict[str, Any],  # allowlist: dict[str, Any]
    patron: str,
    formato: str,
    calidad: int,
    resize: str | None,
    ok_count: int,
    err_count: int,
    duration_ms: int,
) -> None:
    from backend.core.history import save_run

    try:
        save_run(
            files=files,
            options=options,
            patron=patron,
            formato=formato,
            calidad=calidad,
            resize=resize,
            ok_count=ok_count,
            err_count=err_count,
            duration_ms=duration_ms,
        )
    except Exception:
        logger.exception("Failed to save conversion history for job %s", job_id)
        log_message("No se pudo guardar el historial de la conversión", "warn", state=state)


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
