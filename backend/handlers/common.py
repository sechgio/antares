"""Shared utilities for handler modules: decorators, validation, process state."""

from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import wraps
from typing import Any

from backend.utils.i18n import set_locale


# ─── Decorador para locale ──────────────────────────────────────────────────

def with_locale(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Auto-set locale from params before executing handler."""
    @wraps(fn)
    def wrapper(params: dict[str, Any]) -> Any:
        set_locale(params.get("locale", "es"))
        return fn(params)
    return wrapper


# ─── Decorador de validación ──────────────────────────────────────────────

def validate_params(*required_params):
    """Decorator to validate required parameters."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(params: dict[str, Any]) -> Any:
            for param in required_params:
                if param not in params or params[param] is None:
                    raise ValueError(f"Missing required parameter: {param}")
            for key in ['files', 'destino', 'path', 'folder']:
                if params.get(key):
                    if isinstance(params[key], list):
                        for f in params[key]:
                            _validate_path(f)
                    else:
                        _validate_path(params[key])
            return fn(params)
        return wrapper
    return decorator


def _validate_path(path: str) -> None:
    """Validate that path doesn't contain traversal attempts."""
    if not path or not isinstance(path, str):
        raise ValueError(f"Invalid path: {path}")
    if '\x00' in path:
        raise ValueError(f"Invalid path: {path}")
    if '../' in path or '..\\' in path or path.endswith(('/..', '\\..')) or path in ('..', '.'):
        raise ValueError(f"Path traversal detected: {path}")
    encoded = path.lower()
    if '%2e%2e' in encoded or '%252e' in encoded:
        raise ValueError(f"Path traversal detected: {path}")


# ─── Estado de procesamiento ────────────────────────────────────────────────

@dataclass
class ProcessState:
    running: bool = False
    progress: int = 0
    total: int = 0
    current_file: str = ""
    ok_count: int = 0
    err_count: int = 0
    logs: list[dict[str, str]] = field(default_factory=list)
    cancel_requested: bool = False
    _lock: threading.Lock = field(default_factory=threading.Lock)


process_state = ProcessState()


def reset_state() -> None:
    with process_state._lock:
        process_state.running = False
        process_state.progress = 0
        process_state.total = 0
        process_state.current_file = ""
        process_state.ok_count = 0
        process_state.err_count = 0
        process_state.logs = []
        process_state.cancel_requested = False


def log_message(msg: str, tag: str = "info") -> None:
    with process_state._lock:
        process_state.logs.insert(0, {"message": msg, "tag": tag})
        if len(process_state.logs) > 100:
            process_state.logs.pop()
