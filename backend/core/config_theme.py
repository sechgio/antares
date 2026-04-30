"""Configuración personalizable de colores/temas de la aplicación."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from backend.utils.paths import user_data_path

logger = logging.getLogger(__name__)

DEFAULT_THEME: dict[str, str] = {
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

PRESETS: dict[str, dict[str, str]] = {
    "Slate Professional": dict(DEFAULT_THEME),
    "Graphite Focus": {
        "name": "Graphite Focus",
        "bg": "#111315",
        "bg_secondary": "#1B1F23",
        "fg": "#F2F4F7",
        "fg_muted": "#98A2B3",
        "fg_secondary": "#D0D5DD",
        "fg_tertiary": "#667085",
        "accent": "#A3E635",
        "accent_light": "#D9F99D",
        "accent_hover": "#84CC16",
        "accent_dark": "#4D7C0F",
        "border": "#30363D",
        "blue_hover": "#38BDF8",
        "error": "#F97066",
        "warning": "#FDB022",
        "success": "#32D583",
        "orange": "#F79009",
    },
    "Porcelain Light": {
        "name": "Porcelain Light",
        "bg": "#F7F8FA",
        "bg_secondary": "#FFFFFF",
        "fg": "#182230",
        "fg_muted": "#667085",
        "fg_secondary": "#475467",
        "fg_tertiary": "#98A2B3",
        "accent": "#475467",
        "accent_light": "#D0D5DD",
        "accent_hover": "#344054",
        "accent_dark": "#101828",
        "border": "#D0D5DD",
        "blue_hover": "#0EA5E9",
        "error": "#D92D20",
        "warning": "#DC6803",
        "success": "#039855",
        "orange": "#1570EF",
    },
    "Steel Blue": {
        "name": "Steel Blue",
        "bg": "#08111F",
        "bg_secondary": "#102033",
        "fg": "#E6EEF8",
        "fg_muted": "#8FA4BD",
        "fg_secondary": "#B8C7D9",
        "fg_tertiary": "#61758C",
        "accent": "#38BDF8",
        "accent_light": "#BAE6FD",
        "accent_hover": "#0EA5E9",
        "accent_dark": "#0369A1",
        "border": "#22364F",
        "blue_hover": "#22D3EE",
        "error": "#FB7185",
        "warning": "#FBBF24",
        "success": "#34D399",
        "orange": "#60A5FA",
    },
    "Olive Operations": {
        "name": "Olive Operations",
        "bg": "#10140D",
        "bg_secondary": "#1B2316",
        "fg": "#F3F7EF",
        "fg_muted": "#A8B79A",
        "fg_secondary": "#CED9C2",
        "fg_tertiary": "#748566",
        "accent": "#84CC16",
        "accent_light": "#BEF264",
        "accent_hover": "#65A30D",
        "accent_dark": "#365314",
        "border": "#34452A",
        "blue_hover": "#2DD4BF",
        "error": "#F87171",
        "warning": "#FACC15",
        "success": "#4ADE80",
        "orange": "#A3E635",
    },
    "Copper Night": {
        "name": "Copper Night",
        "bg": "#17110D",
        "bg_secondary": "#241A14",
        "fg": "#FFF7ED",
        "fg_muted": "#BFA38C",
        "fg_secondary": "#E7D1BC",
        "fg_tertiary": "#8E6F59",
        "accent": "#F97316",
        "accent_light": "#FDBA74",
        "accent_hover": "#EA580C",
        "accent_dark": "#9A3412",
        "border": "#493122",
        "blue_hover": "#38BDF8",
        "error": "#FB7185",
        "warning": "#FBBF24",
        "success": "#84CC16",
        "orange": "#FB923C",
    },
    "Mono Contrast": {
        "name": "Mono Contrast",
        "bg": "#000000",
        "bg_secondary": "#111111",
        "fg": "#ffffff",
        "fg_muted": "#ffffff",
        "fg_secondary": "#cccccc",
        "fg_tertiary": "#999999",
        "accent": "#ffff00",
        "accent_light": "#ffff66",
        "accent_hover": "#00ffff",
        "accent_dark": "#cccc00",
        "border": "#ffffff",
        "blue_hover": "#00ffff",
        "error": "#ff0000",
        "warning": "#ffaa00",
        "success": "#00ff00",
        "orange": "#ff8800",
    },
    "Solar Claro": {
        "name": "Solar Claro",
        "bg": "#F8FAFC",
        "bg_secondary": "#FFFFFF",
        "fg": "#172033",
        "fg_muted": "#64748B",
        "fg_secondary": "#475569",
        "fg_tertiary": "#94A3B8",
        "accent": "#0EA5E9",
        "accent_light": "#7DD3FC",
        "accent_hover": "#0284C7",
        "accent_dark": "#075985",
        "border": "#CBD5E1",
        "blue_hover": "#14B8A6",
        "error": "#DC2626",
        "warning": "#D97706",
        "success": "#16A34A",
        "orange": "#F59E0B",
    },
    "Bosque Operativo": {
        "name": "Bosque Operativo",
        "bg": "#07130F",
        "bg_secondary": "#10231D",
        "fg": "#F0FDF4",
        "fg_muted": "#A7C8B6",
        "fg_secondary": "#86A998",
        "fg_tertiary": "#638173",
        "accent": "#22C55E",
        "accent_light": "#86EFAC",
        "accent_hover": "#16A34A",
        "accent_dark": "#166534",
        "border": "#235341",
        "blue_hover": "#2DD4BF",
        "error": "#F87171",
        "warning": "#FBBF24",
        "success": "#4ADE80",
        "orange": "#A3E635",
    },
    "Amanecer Ambar": {
        "name": "Amanecer Ambar",
        "bg": "#1C1208",
        "bg_secondary": "#2A1A0D",
        "fg": "#FFF7ED",
        "fg_muted": "#D6B08A",
        "fg_secondary": "#C6925C",
        "fg_tertiary": "#92683C",
        "accent": "#F59E0B",
        "accent_light": "#FCD34D",
        "accent_hover": "#D97706",
        "accent_dark": "#92400E",
        "border": "#6B3E18",
        "blue_hover": "#38BDF8",
        "error": "#FB7185",
        "warning": "#FBBF24",
        "success": "#84CC16",
        "orange": "#FB923C",
    },
    "Neon Grid": {
        "name": "Neon Grid",
        "bg": "#070713",
        "bg_secondary": "#111126",
        "fg": "#F8FAFC",
        "fg_muted": "#A5B4FC",
        "fg_secondary": "#C4B5FD",
        "fg_tertiary": "#818CF8",
        "accent": "#22D3EE",
        "accent_light": "#67E8F9",
        "accent_hover": "#A855F7",
        "accent_dark": "#0891B2",
        "border": "#312E81",
        "blue_hover": "#F472B6",
        "error": "#FF4D8D",
        "warning": "#FACC15",
        "success": "#34D399",
        "orange": "#A855F7",
    },
}

_CONFIG_PATH: Path | None = None


def _config_file() -> Path:
    global _CONFIG_PATH
    if _CONFIG_PATH is None:
        _CONFIG_PATH = user_data_path("theme_config.json")
    return _CONFIG_PATH


def load_theme() -> dict[str, str]:
    """Carga el tema desde disco o retorna el default."""
    path = _config_file()
    if path.exists():
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and "bg" in data:
                theme = dict(DEFAULT_THEME)
                theme.update(data)
                return theme
        except (json.JSONDecodeError, OSError, TypeError) as exc:
            logger.warning("Error leyendo configuración de tema, usando default: %s", exc)
    return dict(DEFAULT_THEME)


def save_theme(theme: dict[str, Any]) -> dict[str, str]:
    """Guarda el tema en disco."""
    path = _config_file()
    validated: dict[str, str] = {}
    for k, v in theme.items():
        if isinstance(v, str) and v.startswith("#"):
            validated[k] = v
        else:
            validated[k] = str(v)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(validated, f, indent=2, ensure_ascii=False)
    return validated


def reset_theme() -> dict[str, str]:
    """Restaura el tema por defecto."""
    save_theme(DEFAULT_THEME)
    return dict(DEFAULT_THEME)


def get_preset_names() -> list[str]:
    """Retorna la lista de nombres de presets disponibles."""
    return list(PRESETS.keys())


def load_preset(name: str) -> dict[str, str]:
    """Retorna una copia del preset solicitado o el default si no existe."""
    preset = PRESETS.get(name)
    if preset:
        return dict(preset)
    return dict(DEFAULT_THEME)
