"""Shared utilities for handler modules: decorators, validation, process state."""

from __future__ import annotations

from functools import wraps
from typing import TYPE_CHECKING, Any

from collections import deque

from backend.core.state import ProcessState
from backend.utils.i18n import set_locale

if TYPE_CHECKING:
    from collections.abc import Callable

def with_locale(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Auto-set locale from params before executing handler."""
    @wraps(fn)
    def wrapper(params: dict[str, Any]) -> Any:
        set_locale(params.get("locale", "es"))
        return fn(params)
    return wrapper


def validate_params(*required_params):
    """Decorator to validate required parameters."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(params: dict[str, Any]) -> Any:
            for param in required_params:
                if param not in params or params[param] is None:
                    msg = f"Missing required parameter: {param}"
                    raise ValueError(msg)
            for key in ["files", "destino", "path", "folder"]:
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
        msg = f"Invalid path: {path}"
        raise ValueError(msg)
    if "\x00" in path:
        msg = f"Invalid path: {path}"
        raise ValueError(msg)
    if "../" in path or "..\\" in path or path.endswith(("/..", "\\..")) or path in ("..", "."):
        msg = f"Path traversal detected: {path}"
        raise ValueError(msg)
    encoded = path.lower()
    if "%2e%2e" in encoded or "%252e" in encoded:
        msg = f"Path traversal detected: {path}"
        raise ValueError(msg)


# Legacy singleton for backward compatibility with existing frontend
process_state = ProcessState()


def reset_state(state: ProcessState | None = None) -> None:
    """Reset a ProcessState. Defaults to the legacy singleton for backward compat."""
    target = state or process_state
    with target._lock:
        target.running = False
        target.progress = 0
        target.total = 0
        target.current_file = ""
        target.ok_count = 0
        target.err_count = 0
        target.logs = []
        target.cancel_requested = False


def log_message(msg: str, tag: str = "info", state: ProcessState | None = None) -> None:
    """Log a message to a ProcessState. Defaults to the legacy singleton for backward compat."""
    target = state or process_state
    with target._lock:
        # Use deque-like capping: prepend and trim to 100 max
        target.logs.insert(0, {"message": msg, "tag": tag})
        if len(target.logs) > 100:
            del target.logs[100:]
