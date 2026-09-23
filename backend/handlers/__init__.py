
from __future__ import annotations

import importlib
import logging
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any, cast

from backend.core.import_guard import serialized_import
from backend.core.ipc_catalog import BACKEND_HANDLER_MODULES, handler_module_for
from backend.core.observability import log_event
from backend.core.state import process_state, reset_state

logger = logging.getLogger(__name__)

WARM_CRITICAL_DONE = threading.Event()

_HANDLER_MODULES: tuple[str, ...] = tuple(sorted(BACKEND_HANDLER_MODULES))

_CORE_HANDLER_MODULES: tuple[str, ...] = (
    "backend.handlers.info",
    "backend.handlers.diagnostics",
    "backend.handlers.theme",
    "backend.handlers.history",
    "backend.handlers.database",
    "backend.handlers.templates",
)

_POST_READY_HANDLER_MODULES: tuple[str, ...] = (
    "backend.handlers.canvas",
    "backend.handlers.conversion",
)

_DEFERRED_HANDLER_MODULES: tuple[str, ...] = tuple(
    m
    for m in _HANDLER_MODULES
    if m not in _CORE_HANDLER_MODULES and m not in _POST_READY_HANDLER_MODULES
)

def _module_for_method(method: str) -> str | None:
    return handler_module_for(method)


class HandlerRegistry:

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
        with self._lock:
            if mod_name in self._loaded_modules:
                return
        with self._module_lock(mod_name):
            with self._lock:
                if mod_name in self._loaded_modules:
                    return
            with serialized_import():
                mod = importlib.import_module(mod_name)
            group = mod.HANDLERS
            with self._lock:
                self._map.update(group)
                self._loaded_modules.add(mod_name)

    def warm(self, modules: tuple[str, ...] | None = None) -> list[str]:
        failed: list[str] = []
        for mod_name in modules if modules is not None else _HANDLER_MODULES:
            try:
                self._load_module(mod_name)
            except Exception:
                failed.append(mod_name)
                logger.exception("Handler warm-up failed for %s", mod_name)
        log_event(logger, logging.INFO, "handlers.warmed", count=len(self._map), message=f"Handler registry warmed ({len(self._map)} methods)")
        return failed

    def warm_core(self) -> list[str]:
        return self.warm(_CORE_HANDLER_MODULES)

    def warm_post_ready(self) -> None:
        # No envolver warm() en serialized_import: _load_module adquiere
        # module_lock y luego serialized_import, así que retener el lock global
        # aquí crea un ciclo ABBA con resoluciones lazy concurrentes.
        try:
            self.warm(_POST_READY_HANDLER_MODULES)
        except Exception:
            log_event(logger, logging.ERROR, "handlers.warm_post_ready", outcome="failed", message="canvas/conversion post-ready warm failed", exc_info=True)
        try:
            from backend.core.canvas.store import get_canvas_store

            get_canvas_store().list_documents()
            log_event(logger, logging.INFO, "handlers.warm_canvas_store", outcome="success", message="canvas store post-ready warm complete")
        except Exception:
            log_event(logger, logging.ERROR, "handlers.warm_canvas_store", outcome="failed", message="canvas store post-ready warm failed", exc_info=True)
        WARM_CRITICAL_DONE.set()
        self._warm_formatos_core()
        try:
            def _warm_history_bg() -> None:
                try:
                    with serialized_import():
                        from backend.core.history import _ensure_table

                    _ensure_table()
                    log_event(logger, logging.INFO, "handlers.warm_history_schema", outcome="success", message="history schema background warm complete")
                except Exception:
                    log_event(logger, logging.ERROR, "handlers.warm_history_schema", outcome="failed", message="history schema background warm failed", exc_info=True)

            executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="history-warm")
            executor.submit(_warm_history_bg)
            executor.shutdown(wait=False)
        except Exception:
            logger.exception("history schema background warm submission failed")

    def warm_deferred(self) -> None:
        self.warm(_DEFERRED_HANDLER_MODULES)

    def _warm_formatos_core(self) -> None:
        try:
            with serialized_import():
                import backend.core.formatos  # noqa: F401

            log_event(logger, logging.INFO, "handlers.warm_formatos_core", outcome="success", message="formatos core post-ready warm complete")
        except Exception:
            log_event(logger, logging.ERROR, "handlers.warm_formatos_core", outcome="failed", message="formatos core post-ready warm failed", exc_info=True)

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
        with self._lock:
            return self._map.get(key, default)

    def is_known(self, method: str) -> bool:
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


HANDLERS = HandlerRegistry()

_state = process_state
_reset_state = reset_state


__all__ = ["HANDLERS", "HandlerRegistry", "_reset_state", "_state"]
