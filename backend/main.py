
from __future__ import annotations

import sys
from pathlib import Path

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

_backend_dir = Path(__file__).resolve().parent
sys.path = adjust_backend_import_path(
    sys.path,
    _backend_dir,
    frozen=bool(getattr(sys, "frozen", False)),
)

import importlib
import json
import locale
import logging
import os
import signal
import threading
import time
import warnings
import zlib
from concurrent.futures import Future
from typing import Any

from backend.core import ipc_phase_telemetry
from backend.core.database import init_db
from backend.core.exceptions import (
    AntaresBaseException,
    CapacityExceededError,
    MemoryPressureError,
    MethodNotFoundError,
    NotFoundError,
    ValidationError,
)
from backend.core.import_guard import serialized_import
from backend.core.ipc_catalog import HEAVY_METHODS, SYNC_METHODS, lane_for
from backend.core.observability import (
    configure_logging,
    get_context,
    install_exception_hooks,
    log_event,
    request_context,
)
from backend.core.repository import close_connection
from backend.core.scheduler import (
    MEMORY_PRESSURE_RETRY_AFTER_MS,
    MEMORY_PRESSURE_THRESHOLD_MB,
    SchedulerBusy,
    get_scheduler,
    is_memory_pressure,
)
from backend.handlers import HANDLERS, WARM_CRITICAL_DONE
from backend.ipc_protocol import _SKIP, read_message, send_notification, send_response
from backend.utils.i18n import t

_shutdown_requested = False

warnings.filterwarnings("ignore", category=DeprecationWarning)


def _signal_handler(signum, frame) -> None:
    global _shutdown_requested
    _shutdown_requested = True

if hasattr(signal, "SIGTERM"):
    signal.signal(signal.SIGTERM, _signal_handler)
if hasattr(signal, "SIGINT"):
    signal.signal(signal.SIGINT, _signal_handler)

if hasattr(signal, "SIGHUP"):
    signal.signal(signal.SIGHUP, _signal_handler)


configure_logging(sys.stderr)
install_exception_hooks()
logger = logging.getLogger(__name__)

_WARM_WAIT_METHODS = frozenset(HEAVY_METHODS | {"preview"})
_WARM_WAIT_TIMEOUT = 15.0
_PANDAS_METHODS = frozenset({
    "db_export",
    "db_parse_mapping",
    "db_template",
    "generar_ubicaciones",
    "panel_aviso_corte_template",
    "preview_ubicacion",
    "spreadsheet_export_volantes_template",
})
_PANDAS_MAPPING_METHODS = frozenset({"preview", "process_start"})


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


def _user_error_message(exc: Exception) -> AntaresBaseException:
    if isinstance(exc, AntaresBaseException):
        return exc
    if isinstance(exc, FileNotFoundError):
        return NotFoundError("Archivo no encontrado")
    if isinstance(exc, ValueError):
        return ValidationError(str(exc))
    if isinstance(exc, ImportError):
        return AntaresBaseException(str(exc))
    return AntaresBaseException("Error interno del servidor")


_HEARTBEAT_INTERVAL_S = 600.0


def _heartbeat_interval_s() -> float:
    try:
        raw = os.environ.get("ANTARES_HEARTBEAT_INTERVAL_S", "").strip()
        return float(raw) if raw else _HEARTBEAT_INTERVAL_S
    except ValueError:
        return _HEARTBEAT_INTERVAL_S


def _heartbeat_process_snapshot() -> tuple[int, int]:
    try:
        import psutil

        proc = psutil.Process()
        return int(proc.memory_info().rss), int(proc.num_threads())
    except Exception:
        return 0, 0


def _heartbeat_loop(stop: threading.Event, scheduler: Any) -> None:
    while not stop.wait(_heartbeat_interval_s()):
        try:
            rss_bytes, thread_count = _heartbeat_process_snapshot()
            metrics = scheduler.metrics()
            compact = {key: metrics.get(key) for key in (
                "light_active", "light_queued", "heavy_active", "heavy_queued",
                "light_rejected", "heavy_rejected", "memory_pressure", "system_ram_available_mb",
            )}
            fields: dict[str, Any] = {"bytes": rss_bytes, "count": thread_count}
            fields["message"] = json.dumps(compact, separators=(",", ":"))
            if metrics.get("memory_pressure"):
                fields["reason"] = "memory_pressure"
            log_event(
                logger,
                logging.WARNING if metrics.get("memory_pressure") else logging.INFO,
                "backend.heartbeat",
                **fields,
            )
        except Exception:
            logger.debug("heartbeat emit failed", exc_info=True)


def _ipc_telemetry_verbose() -> bool:
    raw = os.environ.get("ANTARES_IPC_TELEMETRY", "").strip().lower()
    return raw in {"1", "true", "yes"}


def _maybe_log_ipc_timing(method_name: str, elapsed_ms: float, *, ok: bool, request_id: str | int | None=None) -> None:
    slow = elapsed_ms >= 5_000.0
    sampled = request_id is not None and zlib.crc32(str(request_id).encode("utf-8")) % 100 == 0
    if not _ipc_telemetry_verbose() and not slow and ok and not sampled:
        return
    level = logging.WARNING if slow or not ok else logging.INFO
    fields: dict[str, Any] = {
        "method": method_name,
        "duration_ms": round(elapsed_ms),
        "outcome": "success" if ok else "failed",
        "message": f"ipc method={method_name} elapsed_ms={elapsed_ms:.1f} ok={ok}",
    }
    if slow:
        fields["reason"] = "slow"
    log_event(logger, level, "backend.ipc.timing", **fields)


def _dispatch(handler, params, msg_id, method_name) -> None:
    lane = lane_for(method_name)
    with request_context(request_id=msg_id, method=method_name, lane=lane):
        _dispatch_with_context(handler, params, msg_id, method_name)


def _dispatch_with_context(handler, params, msg_id, method_name) -> None:
    if method_name in _WARM_WAIT_METHODS:
        WARM_CRITICAL_DONE.wait(timeout=_WARM_WAIT_TIMEOUT)
    ipc_phase_telemetry.mark(msg_id, "dispatch_start")
    ipc_phase_telemetry.set_fields(msg_id, method=method_name)
    t0 = time.perf_counter()
    try:
        result = handler(params)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        _maybe_log_ipc_timing(method_name, elapsed_ms, ok=True, request_id=msg_id)
        ipc_phase_telemetry.mark(msg_id, "handler_end")
        ipc_phase_telemetry.set_fields(msg_id, handler_ok=True, handler_ms=elapsed_ms)
        send_response(result, msg_id)
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        _maybe_log_ipc_timing(method_name, elapsed_ms, ok=False, request_id=msg_id)
        user_msg = _user_error_message(exc)
        logger.exception("Error en %s: %s", method_name, user_msg)
        ipc_phase_telemetry.mark(msg_id, "handler_end")
        ipc_phase_telemetry.set_fields(msg_id, handler_ok=False, handler_ms=elapsed_ms, ok=False)
        send_response(None, msg_id, error=user_msg)


def _log_future_exception(future: Future) -> None:
    try:
        future.result()
    except BaseException as handler_exc:
        logger.exception("Handler raised: %s", handler_exc)


def _preload_pandas_for_worker(method_name: str, params: dict[str, Any]) -> None:
    if sys.platform != "win32":
        return
    if method_name not in _PANDAS_METHODS and not (
        method_name in _PANDAS_MAPPING_METHODS
        and params.get("mapping_path")
        and not params.get("mapping")
    ):
        return
    try:
        with serialized_import():
            importlib.import_module("pandas")
    except Exception:
        logger.debug("pandas preload before handler dispatch failed", exc_info=True)


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
    lane = lane_for(method_name)
    ipc_phase_telemetry.set_fields(msg_id, method=method_name, lane=lane)
    ipc_phase_telemetry.mark(msg_id, "enqueue")
    scheduler = get_scheduler()
    # El pre-check solo importa handlers.canvas cuando hay presión de memoria
    # real; sin presión los checks internos no-opean, así que evitamos bloquear
    # el lector JSON-RPC con el serialized_import del módulo pesado.
    if method_name in ("canvas_save", "canvas_save_history") and is_memory_pressure():
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
            CapacityExceededError(message, details={"retryable": True, "reason": reason}),
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

    _warm_failed_core = HANDLERS.warm_core()
    if os.environ.get("ANTARES_WARM_DEFERRED", "").strip().lower() in {"1", "true", "yes"}:
        HANDLERS.warm_deferred()

    scheduler = get_scheduler()

    heartbeat_stop = threading.Event()
    heartbeat_thread: threading.Thread | None = None
    if _heartbeat_interval_s() > 0 and not os.environ.get("PYTEST_CURRENT_TEST"):
        heartbeat_thread = threading.Thread(
            target=_heartbeat_loop,
            args=(heartbeat_stop, scheduler),
            name="telemetry-heartbeat",
            daemon=True,
        )
        heartbeat_thread.start()

    _consecutive_errors = 0
    _MAX_CONSECUTIVE_ERRORS = 100

    warm_thread: threading.Thread | None = None
    if not _shutdown_requested:
        logger.info(t("info.backend_ready"))
        ready_payload: dict[str, Any] = {
            "status": "ok" if not _warm_failed_core else "degraded",
            "backend_version": get_context()["backend_version"],
        }
        if _warm_failed_core:
            ready_payload["failed_handler_modules"] = sorted(_warm_failed_core)
            logger.error("Backend ready but degraded: failed core handler modules %s", _warm_failed_core)
        send_notification("ready", ready_payload)
        def _post_ready_warm():
            try:
                HANDLERS.warm_post_ready()
            except Exception:
                logger.exception("warm_post_ready failed")
        warm_thread = threading.Thread(target=_post_ready_warm, name="post-ready-warm", daemon=True)
        warm_thread.start()

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
                    logger.info("EOF on stdin — pipe closed. Exiting immediately.")
                    break
                if msg is _SKIP:
                    _consecutive_errors = max(0, _consecutive_errors - 1)
                    continue

                _preload_pandas_for_worker(msg.method, msg.params)
                handler = HANDLERS.get_loaded(msg.method)
                if handler is None and HANDLERS.is_known(msg.method):
                    def _deferred_resolver(params, _method=msg.method):
                        h = HANDLERS.get(_method)
                        if h is None:
                            log_event(
                                logger,
                                logging.WARNING,
                                "backend.ipc.unknown_method",
                                method=_method,
                                outcome="rejected",
                                message=f"Método desconocido: {_method}",
                            )
                            raise MethodNotFoundError(f"Método desconocido: {_method}")
                        return h(params)
                    deferred = _deferred_resolver
                else:
                    deferred = None

                if msg.method in SYNC_METHODS and (handler is not None or deferred is not None):
                    ipc_phase_telemetry.set_fields(msg.id, method=msg.method, lane="sync")
                    _dispatch(handler or deferred, msg.params, msg.id, msg.method)
                elif handler is not None:
                    _submit_handler(handler, msg.params, msg.id, msg.method)
                elif deferred is not None:
                    _submit_handler(deferred, msg.params, msg.id, msg.method)
                else:
                    log_event(
                        logger,
                        logging.WARNING,
                        "backend.ipc.unknown_method",
                        method=msg.method,
                        outcome="rejected",
                        message=f"Método IPC no reconocido: {msg.method}",
                    )
                    ipc_phase_telemetry.set_fields(msg.id, method=msg.method, lane="-", ok=False)
                    send_response(None, msg.id, error=MethodNotFoundError(f"Método desconocido: {msg.method}"))
                _consecutive_errors = 0
            except Exception as exc:
                _consecutive_errors += 1
                logger.exception("Unexpected error in main loop (consecutive=%d): %s", _consecutive_errors, exc)
                if _consecutive_errors >= _MAX_CONSECUTIVE_ERRORS:
                    logger.error("Too many consecutive errors, exiting.")
                    break
                time.sleep(0.5)
    except KeyboardInterrupt:
        logger.info("Keyboard interrupt received")
    finally:
        heartbeat_stop.set()
        if heartbeat_thread is not None:
            heartbeat_thread.join(timeout=2.0)
        if warm_thread is not None and warm_thread.is_alive():
            warm_thread.join(timeout=5.0)
        scheduler.shutdown(wait=True)
        close_connection()
        logger.info(t("info.backend_shutdown"))


if __name__ == "__main__":
    main()
