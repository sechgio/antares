"""Handler modules — feature-scoped IPC handlers aggregated into a single registry."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from backend.handlers.common import ProcessState, with_locale, validate_params, _validate_path, process_state, reset_state, log_message
from backend.handlers.info import HANDLERS as INFO_HANDLERS
from backend.handlers.database import HANDLERS as DB_HANDLERS
from backend.handlers.conversion import HANDLERS as CONVERSION_HANDLERS
from backend.handlers.theme import HANDLERS as THEME_HANDLERS
from backend.handlers.formatos import HANDLERS as FORMATOS_HANDLERS
from backend.handlers.history import HANDLERS as HISTORY_HANDLERS
from backend.handlers.technical_reports import HANDLERS as TECH_REPORTS_HANDLERS
from backend.handlers.templates import HANDLERS as TEMPLATES_HANDLERS
from backend.handlers.panel_aviso_corte import HANDLERS as PANEL_HANDLERS
from backend.handlers.optimizer import HANDLERS as OPTIMIZER_HANDLERS

HANDLERS: dict[str, Callable[[dict[str, Any]], Any]] = {
    **INFO_HANDLERS,
    **DB_HANDLERS,
    **CONVERSION_HANDLERS,
    **THEME_HANDLERS,
    **FORMATOS_HANDLERS,
    **HISTORY_HANDLERS,
    **TECH_REPORTS_HANDLERS,
    **TEMPLATES_HANDLERS,
    **PANEL_HANDLERS,
    **OPTIMIZER_HANDLERS,
}

# Backward-compatible aliases for tests
_state = process_state
_reset_state = reset_state
_log = log_message


class Handlers:
    """Legacy facade — delegates to feature-scoped modules."""
    process_start = staticmethod(HANDLERS["process_start"])
    process_status = staticmethod(HANDLERS["process_status"])
    process_cancel = staticmethod(HANDLERS["process_cancel"])


__all__ = ["HANDLERS", "_state", "_reset_state", "Handlers"]
