
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from backend.core.config_store import JsonConfigStore
from backend.utils.paths import cached_config_path, resource_path

logger = logging.getLogger(__name__)


_THEME_KEYS = frozenset([
    "name", "bg", "bg_secondary", "fg", "fg_muted", "fg_secondary", "fg_tertiary",
    "accent", "accent_light", "accent_hover", "accent_dark", "border",
    "blue_hover", "error", "warning", "success", "orange",
])

_FALLBACK_DEFAULT_THEME: dict[str, str] = {
    "name": "Slate Professional",
    "bg": "#0F172A",
    "bg_secondary": "#172033",
    "fg": "#F8FAFC",
    "fg_muted": "#94A3B8",
    "fg_secondary": "#CBD5E1",
    "fg_tertiary": "#64748B",
    "accent": "#3B82F6",
    "accent_light": "#93C5FD",
    "accent_hover": "#2563EB",
    "accent_dark": "#1E40AF",
    "border": "#334155",
    "blue_hover": "#14B8A6",
    "error": "#EF4444",
    "warning": "#F59E0B",
    "success": "#22C55E",
    "orange": "#38BDF8",
}


def _load_default_theme() -> dict[str, str]:
    try:
        shared_theme_path = resource_path("shared/default-theme.json")
        if shared_theme_path.is_file():
            with open(shared_theme_path, encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and _THEME_KEYS.issubset(data.keys()):
                return {k: str(v) for k, v in data.items()}
    except Exception as exc:
        logger.warning("Error leyendo shared/default-theme.json: %s", exc)
    return dict(_FALLBACK_DEFAULT_THEME)


DEFAULT_THEME: dict[str, str] = _load_default_theme()


def _load_presets() -> dict[str, dict[str, str]]:
    presets_path = Path(__file__).parent / "presets.json"
    try:
        with open(presets_path, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            logger.warning("presets.json is not a dict, using default only")
            return {"Slate Professional": dict(DEFAULT_THEME)}
        valid: dict[str, dict[str, str]] = {}
        for name, preset in data.items():
            if isinstance(preset, dict) and _THEME_KEYS.issubset(preset.keys()):
                valid[name] = preset
            else:
                logger.warning("Preset '%s' missing keys, skipping", name)
        return valid or {"Slate Professional": dict(DEFAULT_THEME)}
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Error loading presets.json: %s", exc)
        return {"Slate Professional": dict(DEFAULT_THEME)}


PRESETS: dict[str, dict[str, str]] = _load_presets()


_CONFIG_PATH: Path | None = None


def _config_file() -> Path:
    global _CONFIG_PATH
    if _CONFIG_PATH is None:
        _CONFIG_PATH = cached_config_path("theme", "theme_config.json")
    return _CONFIG_PATH


def _parse_theme_payload(data: Any) -> dict[str, str] | None:
    if isinstance(data, dict) and "bg" in data:
        theme = dict(DEFAULT_THEME)
        theme.update(data)
        return theme
    return None


# El tema se re-lee en cada llamada (sin cache): el archivo puede cambiar por
# fuera del proceso y load_theme siempre debe reflejar el disco.
_store: JsonConfigStore[dict[str, str]] = JsonConfigStore(
    lambda: _config_file(),
    default=lambda: dict(DEFAULT_THEME),
    parse=_parse_theme_payload,
    serialize=lambda theme: theme,
    label="configuración de tema",
    cached=False,
)


def load_theme() -> dict[str, str]:
    return _store.load()


def save_theme(theme: dict[str, Any]) -> dict[str, str]:
    validated: dict[str, str] = {}
    for k, v in theme.items():
        if isinstance(v, str) and v.startswith("#"):
            validated[k] = v
        else:
            validated[k] = str(v)
    _store.save(validated)
    return validated


def reset_theme() -> dict[str, str]:
    save_theme(DEFAULT_THEME)
    return dict(DEFAULT_THEME)


def load_preset(name: str) -> dict[str, str]:
    preset = PRESETS.get(name)
    if preset:
        return dict(preset)
    return dict(DEFAULT_THEME)
