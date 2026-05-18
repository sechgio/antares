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
    from bootstrap import adjust_backend_import_path
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
import signal
import time
import traceback
import warnings
from concurrent.futures import Future

from backend.core.database import init_db
from backend.core.plugins import load_plugins_from_dir
from backend.core.repository import close_connection
from backend.core.scheduler import SchedulerBusy, get_scheduler
from backend.handlers import HANDLERS
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
logging.basicConfig(
    level=logging.INFO,
    format="[%(levelname)s] %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger(__name__)

HEAVY_METHODS = {
    "db_import",
    "db_export",
    "db_clear",
    "scan_folder",
    "preview_image",
    "formatos_generate",
    "image_optimizer_zip",
    "technical_reports_import_file",
    "technical_reports_render_html",
    "technical_reports_render_consolidated_html",
    "panel_aviso_corte_parse_excel",
    "panel_aviso_corte_compute_match",
    "panel_aviso_corte_render_pdf",
}


def _validate_encoding() -> None:
    """Validate that system supports required encoding."""
    import os as _os

    try:
        _os.environ["PYTHONIOENCODING"] = "utf-8"
        _os.environ["PYTHONUTF8"] = "1"

        utf8_locales = ["C.UTF-8", "en_US.UTF-8"]
        if sys.platform == "win32":
            utf8_locales.extend(["es-MX", "Spanish_Mexico.UTF-8"])
        locale_ok = False
        for candidate in utf8_locales:
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


# Call at startup
_validate_encoding()


def _dispatch(handler, params, msg_id, method_name) -> None:
    """Run a handler in a worker thread and send its response back."""
    try:
        result = handler(params)
        send_response(result, msg_id)
    except Exception as exc:
        error_msg = f"{type(exc).__name__}: {exc}"
        logger.exception("Error en %s: %s\n%s", method_name, error_msg, traceback.format_exc())
        send_response(None, msg_id, error=error_msg)


def _log_future_exception(future: Future) -> None:
    """Log unexpected executor failures that escape _dispatch."""
    try:
        future.result()
    except Exception as handler_exc:
        logger.exception("Handler raised: %s", handler_exc)


def _submit_handler(handler, params, msg_id, method_name) -> Future | None:
    """Submit one handler onto the appropriate scheduler lane."""
    scheduler = get_scheduler()
    try:
        if method_name in HEAVY_METHODS:
            future = scheduler.submit_heavy(_dispatch, handler, params, msg_id, method_name)
        else:
            future = scheduler.submit_light(_dispatch, handler, params, msg_id, method_name)
    except SchedulerBusy:
        logger.warning("Heavy scheduler saturated while accepting %s: %s", method_name, scheduler.metrics())
        send_response(None, msg_id, error="Backend ocupado: cola de trabajo pesada llena")
        return None
    future.add_done_callback(_log_future_exception)
    return future


def main() -> None:
    """Bucle principal IPC — diseñado para nunca morir.

    Requests are dispatched to a ThreadPoolExecutor so that slow handlers
    (PDF generation, Excel import, etc.) do NOT block the main loop from
    reading subsequent messages on stdin.
    """
    # Handshake: report ready IMMEDIATELY so the spawner doesn't timeout
    # on heavy initialization work.
    send_notification("ready", {"status": "ok"})

    logger.info(t("info.backend_ready"))

    # Initialize heavy resources AFTER handshake to prevent spawner kill loops.
    try:
        init_db()
    except Exception as exc:
        logger.exception("init_db failed during startup: %s", exc)
    try:
        load_plugins_from_dir()
    except Exception as exc:
        logger.exception("load_plugins_from_dir failed during startup: %s", exc)

    scheduler = get_scheduler()

    # Track consecutive errors to avoid spamming logs on persistent issues
    _consecutive_errors = 0
    _MAX_CONSECUTIVE_ERRORS = 100

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
                    # EOF — pipe closed. DO NOT exit; instead, sleep and retry.
                    # This prevents crashes when Electron briefly closes the pipe.
                    logger.warning("EOF on stdin — pipe may have closed. Retrying in 1s...")
                    time.sleep(1.0)
                    _consecutive_errors += 1
                    if _consecutive_errors >= _MAX_CONSECUTIVE_ERRORS:
                        logger.error("Too many consecutive EOF errors, exiting.")
                        break
                    continue
                if msg is _SKIP:
                    _consecutive_errors = max(0, _consecutive_errors - 1)
                    continue  # Parse error, already responded

                if msg.method in HANDLERS:
                    _submit_handler(HANDLERS[msg.method], msg.params, msg.id, msg.method)
                else:
                    send_response(None, msg.id, error=f"Método desconocido: {msg.method}")
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
