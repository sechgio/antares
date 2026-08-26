"""Entrypoint: backend IPC Python para Electron.

Lee mensajes JSON-RPC desde stdin, enruta a handlers, escribe respuestas a stdout.
Incluye un mecanismo de handshake para reportar "ready" al proceso padre (Electron).
"""

from __future__ import annotations

import sys
from pathlib import Path

# Force UTF-8 for stdio streams to prevent encoding issues in IPC pipes on Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

try:
    from bootstrap import adjust_backend_import_path  # type: ignore[import-not-found]
except ModuleNotFoundError:
    from backend.bootstrap import adjust_backend_import_path

# Ensure backend package is importable when running main.py directly.
# When executing `python backend/main.py`, Python adds the script's directory
# to sys.path[0], causing `from backend.core...` to fail because `backend`
# resolves to the directory itself instead of the parent directory.
_backend_dir = Path(__file__).resolve().parent
sys.path = adjust_backend_import_path(
    sys.path,
    _backend_dir,
    frozen=bool(getattr(sys, "frozen", False)),
)

import locale
import logging
import os
import signal
import threading
import time
import traceback
import warnings
from concurrent.futures import Future
from typing import Any

from backend.core import ipc_phase_telemetry
from backend.core.database import init_db
from backend.core.exceptions import AntaresBaseException, MemoryPressureError, MethodNotFoundError
from backend.core.observability import configure_logging, get_context, request_context
from backend.core.plugins import load_plugins_from_dir
from backend.core.repository import close_connection
from backend.core.scheduler import (
    MEMORY_PRESSURE_RETRY_AFTER_MS,
    MEMORY_PRESSURE_THRESHOLD_MB,
    SchedulerBusy,
    get_scheduler,
)
from backend.handlers import HANDLERS, WARM_CRITICAL_DONE
from backend.ipc_protocol import _SKIP, read_message, send_notification, send_response
from backend.utils.i18n import t

_shutdown_requested = False

# Silence tkinter deprecation warning on macOS
warnings.filterwarnings("ignore", category=DeprecationWarning)


def _signal_handler(signum, frame) -> None:
    """Handle termination signals gracefully.

    Only sets a flag — avoids non-async-signal-safe calls (logging, I/O)
    that can deadlock inside a signal handler.
    """
    global _shutdown_requested
    _shutdown_requested = True

if hasattr(signal, "SIGTERM"):
    signal.signal(signal.SIGTERM, _signal_handler)
if hasattr(signal, "SIGINT"):
    signal.signal(signal.SIGINT, _signal_handler)

# Windows doesn't have SIGHUP
if hasattr(signal, "SIGHUP"):
    signal.signal(signal.SIGHUP, _signal_handler)


# Logging to stderr so stdout stays clean for IPC
configure_logging(sys.stderr)
logger = logging.getLogger(__name__)

# Keep aligned with shared/long-running-methods.json for Python-handled methods
# that perform heavy work in the handler itself.
# (html_to_pdf / autoimg_* run in Electron and are intentionally absent here.)
# process_start only spawns a JobManager thread and returns — it must stay off
# HEAVY so a saturated heavy budget cannot reject new jobs. Actual conversion
# work still uses submit_heavy inside the job. FE/Electron may still list
# process_start in long-running-methods.json for timeout classification.
HEAVY_METHODS = {
    "db_import",
    "db_export",
    "db_clear",
    "db_fields_update",
    "db_fields_reset",
    "db_parse_mapping",
    "formatos_generate",
    "formatos_render_template_page",
    "image_optimizer_zip",
    "image_optimizer_save_files",
    "sellador_apply",
    "sellador_inspect_pdf",
    "sellador_render_page",
    "technical_reports_import_file",
    "technical_reports_render_html",
    "technical_reports_render_consolidated_html",
    "informes_v2_import_file",
    "informes_v2_download_template",
    "informes_v2_render_html",
    "informes_v2_render_consolidated_html",
    "fichas_tecnicas_import_file",
    "fichas_tecnicas_render_html",
    "fichas_tecnicas_render_consolidated_html",
    "panel_aviso_corte_parse_excel",
    "panel_aviso_corte_compute_match",
    "panel_aviso_corte_render_pdf",
    "spreadsheet_parse",
    "spreadsheet_get_rows",
    "spreadsheet_export_volantes_template",
    "generar_ubicaciones",
    "preview_ubicacion",
    "evidencia_volanteo_render",
    # Canvas persist/load can carry large DataURL payloads — keep off the light
    # pool so version/process_status probes stay responsive.
    "canvas_get",
    "canvas_save",
    "canvas_save_history",
    "canvas_export_cmyk_pdf",
}

_WARM_WAIT_METHODS = frozenset(
    HEAVY_METHODS - {"canvas_get", "canvas_save", "canvas_save_history"} | {"preview"}
)
_WARM_WAIT_TIMEOUT = 15.0

SYNC_METHODS = frozenset({
    "version",
    "process_status",
    "diagnostics_snapshot",
})


def _utf8_locale_candidates() -> list[str]:
    candidates = ["C.UTF-8", "en_US.UTF-8"]
    if sys.platform == "win32":
        candidates.extend(["es-MX.UTF-8", "Spanish_Mexico.UTF-8"])
    return candidates


def _validate_encoding() -> None:
    try:
        os.environ["PYTHONIOENCODING"] = "utf-8"
        os.environ["PYTHONUTF8"] = "1"

        locale_ok = False
        for candidate in _utf8_locale_candidates():
            try:
                locale.setlocale(locale.LC_ALL, candidate)
                locale_ok = True
                break
            except locale.Error:
                continue

        enc = locale.getpreferredencoding()
        logger.info("System encoding: %s | locale: %s", enc, (locale_ok and candidate) or "default")

    except Exception as e:
        logger.exception("Encoding validation failed: %s", e)
        raise


_validate_encoding()


def _user_error_message(exc: Exception) -> str | AntaresBaseException:
    if isinstance(exc, AntaresBaseException):
        return exc
    if isinstance(exc, FileNotFoundError):
        return "Archivo no encontrado"
    if isinstance(exc, (ValueError, ImportError)):
        return str(exc)
    return "Error interno del servidor"


def _ipc_telemetry_verbose() -> bool:
    raw = os.environ.get("ANTARES_IPC_TELEMETRY", "").strip().lower()
    return raw in {"1", "true", "yes"}


def _maybe_log_ipc_timing(method_name: str, elapsed_ms: float, *, ok: bool) -> None:
    """Cheap handler timing. Always warn when slow; log every call if env enabled."""
    slow = elapsed_ms >= 5_000.0
    if not _ipc_telemetry_verbose() and not slow:
        return
    level = logging.WARNING if slow or not ok else logging.INFO
    logger.log(
        level,
        "ipc method=%s elapsed_ms=%.1f ok=%s",
        method_name,
        elapsed_ms,
        ok,
    )


def _dispatch(handler, params, msg_id, method_name) -> None:
    """Bind request context before running the worker body."""
    lane = "heavy" if method_name in HEAVY_METHODS else "sync" if method_name in SYNC_METHODS else "light"
    with request_context(request_id=msg_id, method=method_name, lane=lane):
        _dispatch_with_context(handler, params, msg_id, method_name)


def _dispatch_with_context(handler, params, msg_id, method_name) -> None:
    """Run a handler in a worker thread and send its response back."""
    # Cold C-extension imports (numpy via pandas, weasyprint, PyMuPDF, …)
    # must never overlap the post-ready warm imports: on Windows two threads
    # loading C extensions at once can deadlock the process (Python import
    # lock x Windows loader lock). Wait for the critical warm to finish; the
    # timeout is a safety valve so a broken warm cannot wedge requests.
    if method_name in _WARM_WAIT_METHODS:
        WARM_CRITICAL_DONE.wait(timeout=_WARM_WAIT_TIMEOUT)
    ipc_phase_telemetry.mark(msg_id, "dispatch_start")
    ipc_phase_telemetry.set_fields(msg_id, method=method_name)
    t0 = time.perf_counter()
    try:
        result = handler(params)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        _maybe_log_ipc_timing(method_name, elapsed_ms, ok=True)
        ipc_phase_telemetry.mark(msg_id, "handler_end")
        ipc_phase_telemetry.set_fields(msg_id, handler_ok=True, handler_ms=elapsed_ms)
        send_response(result, msg_id)
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        _maybe_log_ipc_timing(method_name, elapsed_ms, ok=False)
        user_msg = _user_error_message(exc)
        logger.exception("Error en %s: %s\n%s", method_name, user_msg, traceback.format_exc())
        ipc_phase_telemetry.mark(msg_id, "handler_end")
        ipc_phase_telemetry.set_fields(msg_id, handler_ok=False, handler_ms=elapsed_ms, ok=False)
        send_response(None, msg_id, error=user_msg)


def _log_future_exception(future: Future) -> None:
    """Log unexpected executor failures that escape _dispatch."""
    try:
        future.result()
    except Exception as handler_exc:
        logger.exception("Handler raised: %s", handler_exc)


def _reject_submit(
    msg_id: int,
    method_name: str,
    lane: str,
    error: Any,
    rejected: str | None = None,
) -> None:
    fields: dict[str, object] = {"ok": False, "lane": lane, "method": method_name}
    if rejected is not None:
        fields["rejected"] = rejected
    ipc_phase_telemetry.set_fields(msg_id, **fields)
    send_response(None, msg_id, error=error)

def _submit_handler(handler, params, msg_id, method_name) -> Future | None:
    lane = "heavy" if method_name in HEAVY_METHODS else "light"
    ipc_phase_telemetry.set_fields(msg_id, method=method_name, lane=lane)
    ipc_phase_telemetry.mark(msg_id, "enqueue")
    scheduler = get_scheduler()
    if method_name in ("canvas_save", "canvas_save_history"):
        request_params = params if isinstance(params, dict) else {}
        try:
            from backend.handlers.canvas import (
                _check_history_memory_pressure,
                _check_memory_pressure_or_spill,
            )

            if method_name == "canvas_save":
                doc = request_params.get("document")
                _check_memory_pressure_or_spill(doc if isinstance(doc, dict) else None, context="canvas_save")
            else:
                _check_history_memory_pressure(
                    str(request_params.get("id", "")),
                    request_params.get("past"),
                    request_params.get("future"),
                )
        except MemoryPressureError as mp:
            logger.warning(
                "Rejecting %s pre-queue due to memory_pressure: %s metrics=%s",
                method_name,
                mp.message,
                scheduler.metrics(),
            )
            _reject_submit(msg_id, method_name, lane, mp, rejected="memory_pressure")
            return None
        except Exception:
            logger.exception("Memory pressure pre-queue check failed for %s", method_name)
            _reject_submit(
                msg_id,
                method_name,
                lane,
                "Backend no disponible: no se pudo comprobar la presión de memoria",
                rejected="memory_pressure_check",
            )
            return None
    try:
        if method_name in HEAVY_METHODS:
            future = scheduler.submit_heavy(_dispatch, handler, params, msg_id, method_name)
        else:
            future = scheduler.submit_light(_dispatch, handler, params, msg_id, method_name)
    except SchedulerBusy as exc:
        reason = getattr(exc, "reason", "heavy_queue_full")
        if reason == "memory_pressure":
            memory_error = MemoryPressureError(
                f"Memoria baja: reintente en {MEMORY_PRESSURE_RETRY_AFTER_MS}ms",
                details={
                    "retry_after_ms": MEMORY_PRESSURE_RETRY_AFTER_MS,
                    "threshold_mb": MEMORY_PRESSURE_THRESHOLD_MB,
                    "reason": reason,
                },
            )
            logger.warning(
                "Scheduler memory_pressure while accepting %s: %s",
                method_name,
                scheduler.metrics(),
            )
            _reject_submit(msg_id, method_name, lane, memory_error, rejected=reason)
            return None
        message = (
            "Backend ocupado: cola de trabajo ligera llena"
            if reason == "light_queue_full"
            else "Backend ocupado: cola de trabajo pesada llena"
        )
        logger.warning("Scheduler saturated while accepting %s (%s): %s", method_name, reason, scheduler.metrics())
        _reject_submit(
            msg_id,
            method_name,
            lane,
            message,
            rejected=reason,
        )
        return None
    except Exception:
        logger.exception("Failed to submit %s to scheduler", method_name)
        _reject_submit(msg_id, method_name, lane, "Backend no disponible: no se pudo programar la tarea")
        return None
    if future is not None:
        future.add_done_callback(_log_future_exception)
    return future

def main() -> None:

    try:
        init_db()
    except Exception as exc:
        logger.exception("init_db failed during startup: %s", exc)
        try:
            send_notification("db_init_failed", {"message": str(exc)})
        except Exception:
            logger.exception("Failed to emit db_init_failed notification")
        sys.exit(1)

    # Warm only catalog/shell handlers before the handshake. conversion (Pillow)
    # and canvas warm in a background thread after ready so Electron is not
    # blocked on heavy imports. Deferred feature modules (sellador, ubicaciones,
    # fichas, …) stay lazy unless ANTARES_WARM_DEFERRED=1.
    HANDLERS.warm_core()
    # Pre-import pandas/openpyxl synchronously BEFORE ready: a cold ``import
    # pandas`` in the heavy worker serialized behind the post-ready daemon's
    # import chain for ~122 s on the first db_import (Python import lock x
    # serialized_import guard). Paying ~2-3 s here makes the first db_import
    # hit sys.modules instead of the lock. Failures are non-fatal - the
    # lazy import in importar_excel still retries.
    HANDLERS.warm_pandas_sync()
    if os.environ.get("ANTARES_WARM_DEFERRED", "").strip().lower() in {"1", "true", "yes"}:
        HANDLERS.warm_deferred()

    # Plugins are opt-in: set ANTARES_ENABLE_PLUGINS=1 to load user_data/plugins/*.py
    # at startup. Default off so installs without plugins pay no import/exec cost.
    if os.environ.get("ANTARES_ENABLE_PLUGINS") == "1":
        try:
            load_plugins_from_dir()
        except Exception as exc:
            logger.exception("load_plugins_from_dir failed during startup: %s", exc)

    # Note: ubicaciones map previews now use a lightweight static-map HTTP fetch
    # (OSM tiles / Google Static Maps) instead of a persistent Playwright browser,
    # so there is no browser to pre-warm at startup.
    # spreadsheet_parse is long-running (15 min); avoid background import prewarm —
    # it historically contended the import lock and froze early IPC calls.

    scheduler = get_scheduler()

    # Track consecutive errors to avoid spamming logs on persistent issues
    _consecutive_errors = 0
    _MAX_CONSECUTIVE_ERRORS = 100

    # This is the operational readiness contract consumed by Electron. Keep it
    # immediately before the stdin loop: no synchronous startup work may follow.
    # A process asked to stop during warm-up must never advertise readiness.
    if not _shutdown_requested:
        logger.info(t("info.backend_ready"))
        send_notification("ready", {
            "status": "ok",
            "backend_version": get_context()["backend_version"],
        })
        # Soft-warm convert/canvas off the handshake path (daemon: never blocks quit).
        threading.Thread(
            target=HANDLERS.warm_post_ready,
            name="post-ready-warm",
            daemon=True,
        ).start()

    try:
        while True:
            if _shutdown_requested:
                logger.info("Shutdown signal received, exiting...")
                from contextlib import suppress
                with suppress(Exception):
                    send_notification("backend.shutdown", {"reason": "signal"})
                break

            try:
                msg = read_message()
                if msg is None:
                    # EOF — pipe closed. Exit immediately to prevent zombie processes.
                    logger.info("EOF on stdin — pipe closed. Exiting immediately.")
                    break
                if msg is _SKIP:
                    _consecutive_errors = max(0, _consecutive_errors - 1)
                    continue  # Parse error, already responded

                handler = HANDLERS.get_loaded(msg.method)
                if handler is not None:
                    if msg.method in SYNC_METHODS:
                        # Answer immediately so liveness checks stay green while
                        # heavy conversion/PDF work occupies the scheduler pool.
                        ipc_phase_telemetry.set_fields(msg.id, method=msg.method, lane="sync")
                        _dispatch(handler, msg.params, msg.id, msg.method)
                    else:
                        _submit_handler(handler, msg.params, msg.id, msg.method)
                elif HANDLERS.is_known(msg.method):
                    # Módulo deferred (ubicaciones, sellador, fichas…): resolver
                    # el handler DENTRO del worker. El import del módulo (~120-450
                    # ms con C extensions) no debe congelar el thread del reader,
                    # que atiende health probes y el resto del IPC.
                    if msg.method in SYNC_METHODS:
                        # Defensa: un sync en módulo deferred responde inline
                        # (no debería ocurrir — los sync viven en core, siempre
                        # cargados). get_loaded: nunca importar en el reader.
                        sync_handler = HANDLERS.get_loaded(msg.method)
                        if sync_handler is not None:
                            ipc_phase_telemetry.set_fields(msg.id, method=msg.method, lane="sync")
                            _dispatch(sync_handler, msg.params, msg.id, msg.method)
                        else:
                            ipc_phase_telemetry.set_fields(msg.id, method=msg.method, lane="-", ok=False)
                            send_response(None, msg.id, error=MethodNotFoundError(f"Método desconocido: {msg.method}"))
                    else:
                        def _deferred_resolver(params, _method=msg.method):
                            h = HANDLERS.get(_method)
                            if h is None:
                                raise MethodNotFoundError(f"Método desconocido: {_method}")
                            return h(params)

                        _submit_handler(_deferred_resolver, msg.params, msg.id, msg.method)
                else:
                    ipc_phase_telemetry.set_fields(msg.id, method=msg.method, lane="-", ok=False)
                    send_response(None, msg.id, error=MethodNotFoundError(f"Método desconocido: {msg.method}"))
                _consecutive_errors = 0
            except Exception as exc:
                # Global handler: any unexpected exception in the loop should NOT kill the process
                _consecutive_errors += 1
                logger.exception("Unexpected error in main loop (consecutive=%d): %s", _consecutive_errors, exc)
                if _consecutive_errors >= _MAX_CONSECUTIVE_ERRORS:
                    logger.error("Too many consecutive errors, exiting.")
                    break
                time.sleep(0.5)
    except KeyboardInterrupt:
        logger.info("Keyboard interrupt received")
    finally:
        scheduler.shutdown(wait=True)
        close_connection()
        logger.info(t("info.backend_shutdown"))


if __name__ == "__main__":
    main()
