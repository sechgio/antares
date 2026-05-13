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
import os
import signal
import traceback
import warnings

from backend.core.database import init_db
from backend.core.plugins import load_plugins_from_dir
from backend.core.repository import close_connection
from backend.handlers import HANDLERS
from backend.ipc_protocol import _SKIP, read_message, send_notification, send_response
from backend.utils.i18n import t

_shutdown_requested = False

# Silence tkinter deprecation warning on macOS
warnings.filterwarnings("ignore", category=DeprecationWarning)

init_db()
load_plugins_from_dir()


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


def _validate_encoding() -> None:
    """Validate that system supports required encoding."""
    try:
        import os
        os.environ["PYTHONIOENCODING"] = "utf-8"
        os.environ["PYTHONUTF8"] = "1"

        try:
            locale.setlocale(locale.LC_ALL, "C.UTF-8")
        except locale.Error:
            try:
                locale.setlocale(locale.LC_ALL, "en_US.UTF-8")
            except locale.Error:
                logger.warning("Could not set UTF-8 locale, using system default")

        logger.info(f"System encoding: {locale.getpreferredencoding()}")

    except Exception as e:
        logger.exception(f"Encoding validation failed: {e}")
        raise


# Call at startup
_validate_encoding()


def main() -> None:
    """Bucle principal IPC."""
    # Handshake: report ready so Electron knows the pipe is open
    send_notification("ready", {"status": "ok"})

    logger.info(t("info.backend_ready"))

    try:
        while True:
            if _shutdown_requested:
                logger.info("Shutdown signal received, exiting...")
                try:
                    send_notification("backend.shutdown", {"reason": "signal"})
                except Exception:
                    pass
                break

            msg = read_message()
            if msg is None:
                break  # EOF — pipe closed
            if msg is _SKIP:
                continue  # Parse error, already responded

            if msg.method in HANDLERS:
                try:
                    result = HANDLERS[msg.method](msg.params)
                    send_response(result, msg.id)
                except Exception as exc:
                    error_msg = f"{type(exc).__name__}: {exc}"
                    logger.exception("Error en %s: %s\n%s", msg.method, error_msg, traceback.format_exc())
                    send_response(None, msg.id, error=error_msg)
            else:
                send_response(None, msg.id, error=f"Método desconocido: {msg.method}")
    except KeyboardInterrupt:
        logger.info("Keyboard interrupt received")
    finally:
        close_connection()
        logger.info(t("info.backend_shutdown"))


if __name__ == "__main__":
    main()
