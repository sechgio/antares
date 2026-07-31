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
from typing import TYPE_CHECKING, Any

from backend.handlers.common import (
    process_state,
    reset_state,
)

if TYPE_CHECKING:
    from collections.abc import Callable

logger = logging.getLogger(__name__)

# (module path, HANDLERS attribute name) — used by warm() only.
_HANDLER_GROUPS: tuple[tuple[str, str], ...] = (
    ("backend.handlers.info", "HANDLERS"),
    ("backend.handlers.theme", "HANDLERS"),
    ("backend.handlers.history", "HANDLERS"),
    ("backend.handlers.database", "HANDLERS"),
    ("backend.handlers.templates", "HANDLERS"),
    ("backend.handlers.canvas", "HANDLERS"),
    ("backend.handlers.conversion", "HANDLERS"),
    ("backend.handlers.formatos", "HANDLERS"),
    ("backend.handlers.optimizer", "HANDLERS"),
    ("backend.handlers.sellador", "HANDLERS"),
    ("backend.handlers.technical_reports", "HANDLERS"),
    ("backend.handlers.fichas_tecnicas", "HANDLERS"),
    ("backend.handlers.panel_aviso_corte", "HANDLERS"),
    ("backend.handlers.ubicaciones", "HANDLERS"),
    ("backend.handlers.evidencia_volanteo", "HANDLERS"),
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

    def warm(self) -> None:
        """Eagerly load all handler modules (call from a background thread)."""
        for mod_name, _attr in _HANDLER_GROUPS:
            try:
                self._load_module(mod_name)
            except Exception:
                logger.exception("Handler warm-up failed for %s", mod_name)
        logger.info("Handler registry warmed (%d methods)", len(self._map))

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
        return handler

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
