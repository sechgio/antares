"""Conversion process handlers: preview, start, status, cancel."""
from __future__ import annotations

import os
import threading
from concurrent.futures import CancelledError, ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from backend.core.converter import FORMATOS_SOPORTADOS, convertir_imagen, copiar_archivo, copiar_video, es_video
from backend.core.database import buscar_por_codigo
from backend.core.renamer import RenamerEngine
from backend.handlers.common import log_message, process_state, reset_state, validate_params, with_locale
from backend.ipc_protocol import send_notification
from backend.utils.i18n import set_locale, t
from backend.utils.validators import parse_filename_parts


@with_locale
@validate_params('files')
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
@validate_params('files', 'destino')
def process_start(params: dict[str, Any]) -> dict[str, bool]:
    with process_state._lock:
        if process_state.running:
            log_message(t("error.process_already_running"), "warn")
            return {"started": False}
    files = params.get("files", [])
    if not files or not isinstance(files, list) or len(files) == 0:
        log_message(t("error.no_files_to_process"), "error")
        return {"started": False}
    destino = params.get("destino", "")
    if not destino:
        log_message(t("error.no_destination"), "error")
        return {"started": False}
    reset_state()
    with process_state._lock:
        process_state.running = True
        process_state.total = len(files)
    threading.Thread(target=_process_thread, args=(params,), daemon=True).start()
    return {"started": True}

@with_locale
def process_status(params: dict[str, Any]) -> dict[str, Any]:
    with process_state._lock:
        return {
            "running": process_state.running,
            "progress": process_state.progress,
            "current_file": process_state.current_file,
            "ok_count": process_state.ok_count,
            "err_count": process_state.err_count,
            "logs": process_state.logs.copy(),
        }

@with_locale
def process_cancel(params: dict[str, Any]) -> dict[str, bool]:
    with process_state._lock:
        process_state.cancel_requested = True
    log_message(t("info.process_cancelled"), "warn")
    return {"cancelled": True}

@with_locale
def preview_image(params: dict[str, Any]) -> dict[str, str]:
    from backend.core.converter import convertir_a_preview
    return convertir_a_preview(params.get("path", ""), params.get("formato", "PNG"), params.get("calidad", 85), params.get("resize"))

@with_locale
def is_video(params: dict[str, Any]) -> dict[str, bool]:
    return {"is_video": es_video(params.get("path", ""))}


def _process_thread(params: dict[str, Any]) -> None:
    """Thread de procesamiento en background con conversión paralela."""
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
        resize = (int(resize_ancho), int(resize_alto)) if resize_ancho and resize_alto else None

        if conversion_enabled and formato not in FORMATOS_SOPORTADOS:
            log_message(f"Formato no soportado: {formato}", "error")
            send_notification("process.complete", {"ok_count": 0, "err_count": len(files)})
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

        max_workers = min(os.cpu_count() or 2, 4)
        completed = 0

        def _process_one(task: tuple[str, Path, bool]) -> tuple[bool, str, str]:
            fpath, out_path, is_video_file = task
            p = Path(fpath)
            try:
                if is_video_file:
                    copiar_video(fpath, out_path)
                elif not conversion_enabled:
                    copiar_archivo(fpath, out_path)
                else:
                    convertir_imagen(fpath, out_path, formato, calidad, resize, keep_exif)
                return (True, out_path.name, "")
            except Exception as e:
                return (False, p.name, str(e))

        pool = ThreadPoolExecutor(max_workers=max_workers)
        futures = [pool.submit(_process_one, task) for task in tasks]
        cancelled = False

        try:
            for future in as_completed(futures):
                if not cancelled:
                    with process_state._lock:
                        if process_state.cancel_requested:
                            cancelled = True
                            log_message(t("info.process_cancelled"), "warn")
                            for f in futures:
                                if not f.done():
                                    f.cancel()
                if future.cancelled():
                    continue
                try:
                    success, name, error = future.result()
                except CancelledError:
                    continue
                completed += 1
                with process_state._lock:
                    if success:
                        process_state.ok_count += 1
                        log_message(f"{'Renombrado' if not conversion_enabled else 'Procesado'}: {name}", "ok")
                    else:
                        process_state.err_count += 1
                        log_message(t("error.process_failed", file=name, error=error), "error")
                    process_state.progress = int((completed / total) * 100)
                    process_state.current_file = name
                    progress = process_state.progress
                    current_file = process_state.current_file
                    ok_count = process_state.ok_count
                    err_count = process_state.err_count
                send_notification("process.progress", {
                    "progress": progress, "current_file": current_file,
                    "ok_count": ok_count, "err_count": err_count,
                })
        finally:
            pool.shutdown(wait=True)

        with process_state._lock:
            process_state.running = False
            process_state.progress = 100 if not cancelled else process_state.progress
            ok_count = process_state.ok_count
            err_count = process_state.err_count
        if cancelled:
            log_message(t("info.process_cancelled"), "warn")
        else:
            log_message(t("info.process_complete", ok=ok_count, err=err_count), "info")
        send_notification("process.complete", {"ok_count": ok_count, "err_count": err_count})
        from backend.core.history import save_run
        save_run(
            files=[str(f) for f in files],
            options={"formato": formato, "calidad": calidad, "conversion_enabled": conversion_enabled, "resize": str(resize) if resize else None, "keep_exif": keep_exif, "usar_rename": usar_rename},
            patron=patron, formato=formato, calidad=calidad,
            resize=str(resize) if resize else None, ok_count=ok_count, err_count=err_count,
        )
    finally:
        with process_state._lock:
            process_state.running = False


HANDLERS = {
    "preview": preview,
    "process_start": process_start,
    "process_status": process_status,
    "process_cancel": process_cancel,
    "preview_image": preview_image,
    "is_video": is_video,
}
