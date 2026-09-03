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
    return {"formats": FORMATOS_SOPORTADOS.list_formats()}

HANDLERS = {
    "version": version,
    "formats": formats,
}
