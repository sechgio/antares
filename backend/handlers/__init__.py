"""Handler modules — feature-scoped IPC handlers aggregated into a single registry.

Heavy feature modules (conversion/Pillow, sellador/PyMuPDF, ubicaciones, PDF
renderers, etc.) are imported lazily on targeted registry lookup. Backend startup
warms a minimal core before operational ``ready``; conversion/canvas warm in a
background thread after ready; remaining deferred modules stay lazy unless
``ANTARES_WARM_DEFERRED=1`` eager-warms them before the handshake.

Critical: resolving one method must import only that method's module. An
eager load of every handler group on the IPC reader thread caused
``IPC timeout: fichas_tecnicas_create`` when heavy imports exceeded the 30s
frontend budget (common under frozen builds + antivirus).
"""

from __future__ import annotations

import importlib
import logging
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING, Any, cast

from backend.core.import_guard import serialized_import
from backend.handlers.common import (
    process_state,
    reset_state,
)

if TYPE_CHECKING:
    from collections.abc import Callable

logger = logging.getLogger(__name__)

# Set once the post-ready warm finishes its guarded cold imports. Requests
# that cold-import C extensions wait on it (see backend.main._dispatch).
WARM_CRITICAL_DONE = threading.Event()

# Module paths eagerly imported by warm().
_HANDLER_MODULES: tuple[str, ...] = (
    "backend.handlers.info",
    "backend.handlers.theme",
    "backend.handlers.history",
    "backend.handlers.database",
    "backend.handlers.templates",
    "backend.handlers.canvas",
    "backend.handlers.conversion",
    "backend.handlers.formatos",
    "backend.handlers.optimizer",
    "backend.handlers.sellador",
    "backend.handlers.technical_reports",
    "backend.handlers.informes_v2",
    "backend.handlers.fichas_tecnicas",
    "backend.handlers.panel_aviso_corte",
    "backend.handlers.ubicaciones",
    "backend.handlers.evidencia_volanteo",
    "backend.handlers.spreadsheet",
    "backend.handlers.telemetry",
)

# Modules required before the ready handshake. Keep this list minimal: default
# tab (previewPanel) only needs templates/catalog + light shell handlers.
# conversion (Pillow) and canvas are warmed in a daemon thread after ready so
# they do not block the Electron handshake.
_CORE_HANDLER_MODULES: tuple[str, ...] = (
    "backend.handlers.info",
    "backend.handlers.theme",
    "backend.handlers.history",
    "backend.handlers.database",
    "backend.handlers.templates",
)

# Common next-use modules: warm in background after ready (not on handshake).
_POST_READY_HANDLER_MODULES: tuple[str, ...] = (
    "backend.handlers.canvas",
    "backend.handlers.conversion",
)

# Feature modules warmed after core when ANTARES_WARM_DEFERRED=1; otherwise lazy.
_DEFERRED_HANDLER_MODULES: tuple[str, ...] = tuple(
    m
    for m in _HANDLER_MODULES
    if m not in _CORE_HANDLER_MODULES and m not in _POST_READY_HANDLER_MODULES
)

# Exact method → module for names that do not follow a feature prefix.
_EXACT_MODULE: dict[str, str] = {
    "version": "backend.handlers.info",
    "formats": "backend.handlers.info",
    "preview": "backend.handlers.conversion",
    "is_video": "backend.handlers.conversion",
    "process_start": "backend.handlers.conversion",
    "process_status": "backend.handlers.conversion",
    "process_cancel": "backend.handlers.conversion",
    "db_detect_key_column": "backend.handlers.conversion",
    "generar_ubicaciones": "backend.handlers.ubicaciones",
    "preview_ubicacion": "backend.handlers.ubicaciones",
    "template_get": "backend.handlers.templates",
    "rename_patterns_get": "backend.handlers.database",
    "rename_patterns_update": "backend.handlers.database",
    "rename_patterns_reset": "backend.handlers.database",
    "telemetry": "backend.handlers.telemetry",
}

# Longest-prefix-first feature routing (checked after exact matches).
_PREFIX_MODULE: tuple[tuple[str, str], ...] = (
    ("fichas_tecnicas_", "backend.handlers.fichas_tecnicas"),
    ("informes_v2_", "backend.handlers.informes_v2"),
    ("technical_reports_", "backend.handlers.technical_reports"),
    ("panel_aviso_corte_", "backend.handlers.panel_aviso_corte"),
    ("evidencia_volanteo_", "backend.handlers.evidencia_volanteo"),
    ("image_optimizer_", "backend.handlers.optimizer"),
    ("spreadsheet_", "backend.handlers.spreadsheet"),
    ("rename_patterns_", "backend.handlers.database"),
    ("templates_", "backend.handlers.templates"),
    ("formatos_", "backend.handlers.formatos"),
    ("sellador_", "backend.handlers.sellador"),
    ("history_", "backend.handlers.history"),
    ("canvas_", "backend.handlers.canvas"),
    ("theme_", "backend.handlers.theme"),
    ("db_", "backend.handlers.database"),
)


def _module_for_method(method: str) -> str | None:
    exact = _EXACT_MODULE.get(method)
    if exact is not None:
        return exact
    for prefix, mod_name in _PREFIX_MODULE:
        if method.startswith(prefix):
            return mod_name
    return None


class HandlerRegistry:
    """Dict-like registry that loads one handler module per resolved method."""

    def __init__(self) -> None:
        self._map: dict[str, Callable[[dict[str, Any]], Any]] = {}
        self._loaded_modules: set[str] = set()
        self._lock = threading.RLock()
        self._module_locks: dict[str, threading.RLock] = {}

    def _module_lock(self, mod_name: str) -> threading.RLock:
        with self._lock:
            lock = self._module_locks.get(mod_name)
            if lock is None:
                lock = threading.RLock()
                self._module_locks[mod_name] = lock
            return lock

    def _load_module(self, mod_name: str) -> None:
        """Import one handler module. Safe under concurrent callers."""
        with self._lock:
            if mod_name in self._loaded_modules:
                return
        with self._module_lock(mod_name):
            with self._lock:
                if mod_name in self._loaded_modules:
                    return
            # Serialized with other cold imports: a C-extension load racing
            # another one can deadlock the process on Windows (Python import
            # lock x loader lock), e.g. Pillow here vs numpy in db_import.
            with serialized_import():
                mod = importlib.import_module(mod_name)
            group = mod.HANDLERS
            with self._lock:
                self._map.update(group)
                self._loaded_modules.add(mod_name)

    def warm(self, modules: tuple[str, ...] | None = None) -> None:
        """Eagerly load handler modules. Default: all. Prefer warm_core + warm_deferred at boot."""
        for mod_name in modules if modules is not None else _HANDLER_MODULES:
            try:
                self._load_module(mod_name)
            except Exception:
                logger.exception("Handler warm-up failed for %s", mod_name)
        logger.info("Handler registry warmed (%d methods)", len(self._map))

    def warm_core(self) -> None:
        """Load modules needed before the ready handshake (catalog + light shell)."""
        self.warm(_CORE_HANDLER_MODULES)

    def warm_pandas_sync(self) -> None:
        """Pre-import pandas/openpyxl on the MAIN thread before the ready handshake.

        A cold ``import pandas`` in the heavy worker serializes behind the
        post-ready daemon's import chain via Python's global import lock:
        measured at ~122 s for the first ``db_import`` (worker waited on
        ``serialized_import`` while the warm thread loaded numpy's DLL).
        Importing pandas/openpyxl synchronously before ``ready`` costs
        ~2-3 s of startup but makes the first db_import hit ``sys.modules``
        instead of the lock. Failures are non-fatal - the lazy import in
        ``importar_excel`` still retries with its own error message.
        """
        try:
            with serialized_import():
                import openpyxl  # noqa: F401
                import pandas  # noqa: F401

            logger.info("pandas/openpyxl pre-ready warm complete")
        except Exception:
            logger.exception("pandas/openpyxl pre-ready warm failed")

    def warm_post_ready(self) -> None:
        """Load canvas + conversion after ready so first convert/canvas use is warm.

        Every cold-import block runs under ``serialized_import()``: two threads
        loading C extensions at once can deadlock the process on Windows
        (Python import lock x Windows loader lock). Failures are non-fatal.

        History schema is off the critical path: background ThreadPoolExecutor
        so first ``canvas_list`` (light, no WARM_CRITICAL_DONE wait) never
        contends the ``serialized_import`` lock for ~180 ms DDL
        (179.9 ms vs 3.6 ms via ANTARES_IPC_TELEMETRY).
        """
        # pandas/openpyxl already pre-imported in warm_pandas_sync before ready;
        # never touch them here (would re-contend the 122 s guard).
        try:
            with serialized_import():
                self.warm(_POST_READY_HANDLER_MODULES)
        except Exception:
            logger.exception("canvas/conversion post-ready warm failed")
        # WeasyPrint: import under guard (cold cliff), render outside.
        write_pdf_sanitized: Callable[[str], bytes] | None = None
        try:
            with serialized_import():
                from backend.utils.pdf_html import write_pdf_sanitized
        except Exception:
            logger.exception("WeasyPrint import warm failed")
        # Release cold-import waiters (db_import, renders, preview …).
        WARM_CRITICAL_DONE.set()
        # History warm off critical path: import under guard, DDL outside.
        # Runs concurrently with WeasyPrint render (seconds, no guard).
        try:
            def _warm_history_bg() -> None:
                try:
                    with serialized_import():
                        from backend.core.history import _ensure_table

                    _ensure_table()
                    logger.info("history schema background warm complete")
                except Exception:
                    logger.exception("history schema background warm failed")

            executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="history-warm")
            executor.submit(_warm_history_bg)
            executor.shutdown(wait=False)
        except Exception:
            logger.exception("history schema background warm submission failed")
        if write_pdf_sanitized is not None:
            try:
                write_pdf_sanitized("<!DOCTYPE html><html><body>warm</body></html>")
                logger.info("WeasyPrint post-ready warm complete")
            except Exception:
                logger.exception("WeasyPrint post-ready warm failed")

    def warm_deferred(self) -> None:
        """Load remaining feature modules (opt-in via ANTARES_WARM_DEFERRED)."""
        self.warm(_DEFERRED_HANDLER_MODULES)

    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            if key in self._map:
                return self._map[key]
        mod_name = _module_for_method(key)
        if mod_name is None:
            return default
        self._load_module(mod_name)
        with self._lock:
            return self._map.get(key, default)

    def get_loaded(self, key: str, default: Any = None) -> Any:
        """Devuelve el handler SOLO si su módulo ya está cargado (sin importar).

        El reader de IPC usa esto: los módulos deferred (ubicaciones, sellador,
        …) se resuelven en el worker — un import de ~120-450 ms no debe
        congelar el thread que atiende health probes y demás mensajes.
        """
        with self._lock:
            return self._map.get(key, default)

    def is_known(self, method: str) -> bool:
        """True si el método pertenece a un módulo registrado, cargado o no."""
        return _module_for_method(method) is not None

    def __contains__(self, key: object) -> bool:
        if not isinstance(key, str):
            return False
        return self.get(key) is not None

    def __getitem__(self, key: str) -> Callable[[dict[str, Any]], Any]:
        handler = self.get(key)
        if handler is None:
            raise KeyError(key)
        return cast(Callable[[dict[str, Any]], Any], handler)

    def keys(self) -> Any:
        self.warm()
        with self._lock:
            return self._map.keys()

    def items(self) -> Any:
        self.warm()
        with self._lock:
            return self._map.items()

    def __len__(self) -> int:
        self.warm()
        with self._lock:
            return len(self._map)

    def __iter__(self) -> Any:
        self.warm()
        with self._lock:
            return iter(self._map)


HANDLERS = HandlerRegistry()

# Backward-compatible aliases for tests
_state = process_state
_reset_state = reset_state


__all__ = ["HANDLERS", "HandlerRegistry", "_reset_state", "_state"]
