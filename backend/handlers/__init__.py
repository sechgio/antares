"""Handler modules — feature-scoped IPC handlers aggregated into a single registry.

Heavy feature modules (conversion/Pillow, sellador/PyMuPDF, ubicaciones, PDF
renderers, etc.) are imported lazily on first method dispatch so the backend can
emit ``ready`` without paying full import cost at process start.

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
from typing import TYPE_CHECKING, Any, cast

from backend.handlers.common import (
    process_state,
    reset_state,
)

if TYPE_CHECKING:
    from collections.abc import Callable

logger = logging.getLogger(__name__)

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
)

# Default tab (preview) + catalog/canvas: must be ready before the handshake.
_CORE_HANDLER_MODULES: tuple[str, ...] = (
    "backend.handlers.info",
    "backend.handlers.theme",
    "backend.handlers.history",
    "backend.handlers.database",
    "backend.handlers.templates",
    "backend.handlers.canvas",
    "backend.handlers.conversion",
)

# Feature modules warmed after ready so cold start does not pay pandas/Weasy/etc.
_DEFERRED_HANDLER_MODULES: tuple[str, ...] = tuple(
    m for m in _HANDLER_MODULES if m not in _CORE_HANDLER_MODULES
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
}

# Longest-prefix-first feature routing (checked after exact matches).
_PREFIX_MODULE: tuple[tuple[str, str], ...] = (
    ("fichas_tecnicas_", "backend.handlers.fichas_tecnicas"),
    ("informes_v2_", "backend.handlers.informes_v2"),
    ("technical_reports_", "backend.handlers.technical_reports"),
    ("panel_aviso_corte_", "backend.handlers.panel_aviso_corte"),
    ("evidencia_volanteo_", "backend.handlers.evidencia_volanteo"),
    ("image_optimizer_", "backend.handlers.optimizer"),
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
        """Load modules needed before the ready handshake (preview + canvas + catalog)."""
        self.warm(_CORE_HANDLER_MODULES)

    def warm_deferred(self) -> None:
        """Load remaining feature modules after ready (still sync before the IPC loop)."""
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
