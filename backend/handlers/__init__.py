"""Handler modules — feature-scoped IPC handlers aggregated into a single registry.

Heavy feature modules (conversion/Pillow, sellador/PyMuPDF, ubicaciones, PDF
renderers, etc.) are imported lazily on first method dispatch so the backend can
emit ``ready`` without paying full import cost at process start.
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

# (module path, HANDLERS attribute name) — light modules first for warm-up order.
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


class HandlerRegistry:
    """Dict-like registry that loads handler modules on first access."""

    def __init__(self) -> None:
        self._map: dict[str, Callable[[dict[str, Any]], Any]] = {}
        self._loaded = False
        self._lock = threading.RLock()

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            merged: dict[str, Callable[[dict[str, Any]], Any]] = {}
            for mod_name, attr in _HANDLER_GROUPS:
                mod = importlib.import_module(mod_name)
                group = getattr(mod, attr)
                merged.update(group)
            self._map = merged
            self._loaded = True
            logger.info("Handler registry loaded (%d methods)", len(self._map))

    def warm(self) -> None:
        """Eagerly load all handler modules (call from a background thread)."""
        self._ensure_loaded()

    def __contains__(self, key: object) -> bool:
        self._ensure_loaded()
        return key in self._map

    def __getitem__(self, key: str) -> Callable[[dict[str, Any]], Any]:
        self._ensure_loaded()
        return self._map[key]

    def get(self, key: str, default: Any = None) -> Any:
        self._ensure_loaded()
        return self._map.get(key, default)

    def keys(self) -> Any:
        self._ensure_loaded()
        return self._map.keys()

    def items(self) -> Any:
        self._ensure_loaded()
        return self._map.items()

    def __len__(self) -> int:
        self._ensure_loaded()
        return len(self._map)

    def __iter__(self) -> Any:
        self._ensure_loaded()
        return iter(self._map)


HANDLERS = HandlerRegistry()

# Backward-compatible aliases for tests
_state = process_state
_reset_state = reset_state


__all__ = ["HANDLERS", "_reset_state", "_state"]
