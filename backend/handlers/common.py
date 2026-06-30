"""Shared utilities for handler modules: decorators, validation, process state."""

from __future__ import annotations

from functools import wraps
from typing import TYPE_CHECKING, Any

from backend.core.state import ProcessState
from backend.utils.i18n import set_locale
from backend.utils.validators import is_safe_user_path, path_param_violations

if TYPE_CHECKING:
    from collections.abc import Callable

def with_locale(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Auto-set locale from params before executing handler."""
    @wraps(fn)
    def wrapper(params: dict[str, Any]) -> Any:
        set_locale(params.get("locale", "es"))
        return fn(params)
    return wrapper


def parse_positive_int(value: Any, label: str, *, maximum: int | None = None) -> int:
    """Parse and validate a positive integer from IPC params.

    Centralised so formatos/sellador/optimizer handlers produce the same
    localised error messages instead of letting raw `int(None)`/`int("abc")`
    `TypeError`/`ValueError` bubble up to the renderer.

    Args:
        value: Raw value from params dict (may be str, int, None, etc).
        label: Human-readable field name for error messages.
        maximum: Optional upper bound (inclusive).

    Returns:
        Parsed integer guaranteed to be > 0 and <= maximum when provided.
    """
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        msg = f"{label} inválido"
        raise ValueError(msg) from exc
    if parsed <= 0:
        msg = f"{label} debe ser mayor a cero"
        raise ValueError(msg)
    if maximum is not None and parsed > maximum:
        msg = f"{label} debe ser menor o igual a {maximum}"
        raise ValueError(msg)
    return parsed


def validate_params(*required_params):
    """Decorator to validate required parameters.

    Path-traversal screening delegates to the single shared loop
    ``path_param_violations`` from validators.py (strict mode) so the IPC
    layer and handler layer cannot drift apart. ``_validate_path`` is still
    invoked per violation to raise the original localised error messages.
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(params: dict[str, Any]) -> Any:
            for param in required_params:
                if param not in params or params[param] is None:
                    msg = f"Missing required parameter: {param}"
                    raise ValueError(msg)
            for _key, value in path_param_violations(params, strict=True):
                _validate_path(value)
            return fn(params)
        return wrapper
    return decorator


def _validate_path(path: str) -> None:
    """Validate that path doesn't contain traversal attempts."""
    if not path or not isinstance(path, str):
        msg = f"Invalid path: {path}"
        raise ValueError(msg)
    if not is_safe_user_path(path):
        msg = f"Path traversal detected: {path}"
        raise ValueError(msg)


# Legacy singleton for backward compatibility with existing frontend.
# New code should use the per-Job ProcessState inside JobManager instead.
# See backend/core/jobs.py for context on the legacy single-job surface.
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
