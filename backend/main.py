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

from backend.core.database import init_db
from backend.core.exceptions import AntaresBaseException
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
    "fichas_tecnicas_import_file",
    "fichas_tecnicas_render_html",
    "fichas_tecnicas_render_consolidated_html",
    "panel_aviso_corte_parse_excel",
    "panel_aviso_corte_compute_match",
    "panel_aviso_corte_render_pdf",
    "generar_ubicaciones",
    "preview_ubicacion",
    "evidencia_volanteo_render",
}

# Handlers that must answer on the IPC reader thread. Health probes and UI
# status polls must never wait behind a saturated ThreadPoolExecutor.
SYNC_METHODS = frozenset({
    "version",
    "process_status",
})


def _utf8_locale_candidates() -> list[str]:
    """Return locale names to try for UTF-8 system encoding (platform-specific)."""
    candidates = ["C.UTF-8", "en_US.UTF-8"]
    if sys.platform == "win32":
        # Bare "es-MX" is not a reliable Windows setlocale name; use explicit encoding suffixes.
        candidates.extend(["es-MX.UTF-8", "Spanish_Mexico.UTF-8"])
    return candidates


def _validate_encoding() -> None:
    """Validate that system supports required encoding."""
    import os as _os

    try:
        _os.environ["PYTHONIOENCODING"] = "utf-8"
        _os.environ["PYTHONUTF8"] = "1"

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


# Call at startup
_validate_encoding()


def _dispatch(handler, params, msg_id, method_name) -> None:
    """Run a handler in a worker thread and send its response back."""
    try:
        result = handler(params)
        send_response(result, msg_id)
    except Exception as exc:
        user_msg: str | AntaresBaseException
        if isinstance(exc, AntaresBaseException):
            user_msg = exc
        elif isinstance(exc, (ValueError, FileNotFoundError, ImportError)):
            user_msg = str(exc)
        else:
            user_msg = f"{type(exc).__name__}: {exc}"
        logger.exception("Error en %s: %s\n%s", method_name, user_msg, traceback.format_exc())
        send_response(None, msg_id, error=user_msg)


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
    if future is not None:
        future.add_done_callback(_log_future_exception)
    return future


def main() -> None:
    """Bucle principal IPC — diseñado para nunca morir.

    Requests are dispatched to a ThreadPoolExecutor so that slow handlers
    (PDF generation, Excel import, etc.) do NOT block the main loop from
    reading subsequent messages on stdin.
    """
    # Fail fast on DB init BEFORE the ready handshake so Electron never marks
    # the backend healthy while the catalog is unusable.
    try:
        init_db()
    except Exception as exc:
        logger.exception("init_db failed during startup: %s", exc)
        try:
            send_notification("db_init_failed", {"message": str(exc)})
        except Exception:
            logger.exception("Failed to emit db_init_failed notification")
        sys.exit(1)

    send_notification("ready", {"status": "ok"})

    logger.info(t("info.backend_ready"))

    # Warm heavy handler imports off the critical path so the first light IPC
    # (version / theme) is not blocked by Pillow/PyMuPDF/WeasyPrint loads.
    def _warm_handlers() -> None:
        try:
            HANDLERS.warm()
        except Exception:
            logger.exception("Background handler warm-up failed")

    threading.Thread(target=_warm_handlers, name="handler-warmup", daemon=True).start()

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
                    # EOF — pipe closed. Exit immediately to prevent zombie processes.
                    logger.error("EOF on stdin — pipe closed. Exiting immediately.")
                    break
                if msg is _SKIP:
                    _consecutive_errors = max(0, _consecutive_errors - 1)
                    continue  # Parse error, already responded

                if msg.method in HANDLERS:
                    handler = HANDLERS[msg.method]
                    if msg.method in SYNC_METHODS:
                        # Answer immediately so liveness checks stay green while
                        # heavy conversion/PDF work occupies the scheduler pool.
                        _dispatch(handler, msg.params, msg.id, msg.method)
                    else:
                        _submit_handler(handler, msg.params, msg.id, msg.method)
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
