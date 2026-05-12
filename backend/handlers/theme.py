"""Theme configuration handlers."""
from __future__ import annotations
from typing import Any
from backend.handlers.common import with_locale
from backend.core.config_theme import PRESETS, load_preset, load_theme, reset_theme, save_theme

@with_locale
def theme_get(params: dict[str, Any]) -> dict[str, str]:
    return load_theme()

@with_locale
def theme_save(params: dict[str, Any]) -> dict[str, str]:
    return save_theme(params)

@with_locale
def theme_presets(params: dict[str, Any]) -> dict[str, list[str]]:
    return {"presets": list(PRESETS.keys())}

@with_locale
def theme_preset(params: dict[str, Any]) -> dict[str, str]:
    return load_preset(params.get("name", ""))

@with_locale
def theme_reset(params: dict[str, Any]) -> dict[str, str]:
    return reset_theme()

HANDLERS = {
    "theme_get": theme_get,
    "theme_save": theme_save,
    "theme_presets": theme_presets,
    "theme_preset": theme_preset,
    "theme_reset": theme_reset,
}
