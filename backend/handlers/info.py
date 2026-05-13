"""Info and system handlers."""
from __future__ import annotations

from typing import Any

from backend.handlers.common import with_locale
from backend.version import __version__


@with_locale
def version(params: dict[str, Any]) -> dict[str, str]:
    return {"version": __version__}

@with_locale
def formats(params: dict[str, Any]) -> dict[str, list[str]]:
    from backend.core.converter import FORMATOS_SOPORTADOS
    return {"formats": list(FORMATOS_SOPORTADOS.keys())}

@with_locale
def plugin_formats(params: dict[str, Any]) -> dict[str, list[str]]:
    from backend.core.format_registry import get_registry
    return {"formats": get_registry().list_formats()}

HANDLERS = {
    "version": version,
    "formats": formats,
    "plugin_formats": plugin_formats,
}
