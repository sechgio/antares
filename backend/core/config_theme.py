"""Configuración personalizable de colores/temas de la aplicación."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from backend.utils.paths import user_data_path

logger = logging.getLogger(__name__)

DEFAULT_THEME: dict[str, str] = {
    "name": "Precision Linear",
    "bg": "#0A0D12",
    "bg_secondary": "#111522",
    "fg": "#FFFFFF",
    "fg_muted": "#7C8494",
    "fg_secondary": "#555555",
    "fg_tertiary": "#565656",
    "accent": "#5E6AD2",
    "accent_light": "#8B93FF",
    "accent_hover": "#4D57BE",
    "accent_dark": "#343B8F",
    "border": "#27304E",
    "blue_hover": "#22C7A9",
    "error": "#EB001B",
    "warning": "#F79E1B",
    "success": "#76b900",
    "orange": "#8B93FF",
}

PRESETS: dict[str, dict[str, str]] = {
    "Precision Linear": dict(DEFAULT_THEME),
    "NVIDIA Dark": {
        "name": "NVIDIA Dark",
        "bg": "#000000",
        "bg_secondary": "#1a1a1a",
        "fg": "#ffffff",
        "fg_muted": "#a7a7a7",
        "fg_secondary": "#898989",
        "fg_tertiary": "#757575",
        "accent": "#76b900",
        "accent_light": "#bff230",
        "accent_hover": "#1eaedb",
        "accent_dark": "#5a8f00",
        "border": "#5e5e5e",
        "blue_hover": "#3860be",
        "error": "#e52020",
        "warning": "#ef9100",
        "success": "#76b900",
        "orange": "#df6500",
    },
    "Professional Light": {
        "name": "Professional Light",
        "bg": "#f5f5f5",
        "bg_secondary": "#ffffff",
        "fg": "#1a1a1a",
        "fg_muted": "#555555",
        "fg_secondary": "#777777",
        "fg_tertiary": "#999999",
        "accent": "#76b900",
        "accent_light": "#9bdb00",
        "accent_hover": "#1eaedb",
        "accent_dark": "#5a8f00",
        "border": "#cccccc",
        "blue_hover": "#3860be",
        "error": "#d32f2f",
        "warning": "#f57c00",
        "success": "#388e3c",
        "orange": "#e65100",
    },
    "Midnight Blue": {
        "name": "Midnight Blue",
        "bg": "#0a0e1a",
        "bg_secondary": "#121a2b",
        "fg": "#e0e6f1",
        "fg_muted": "#8a9bb8",
        "fg_secondary": "#6b7fa3",
        "fg_tertiary": "#4a5e80",
        "accent": "#00d4ff",
        "accent_light": "#80e8ff",
        "accent_hover": "#ff6b35",
        "accent_dark": "#0099cc",
        "border": "#1e2d47",
        "blue_hover": "#ff8c5a",
        "error": "#ff4d4d",
        "warning": "#ffa726",
        "success": "#66bb6a",
        "orange": "#ff7043",
    },
    "Carbon Gray": {
        "name": "Carbon Gray",
        "bg": "#181818",
        "bg_secondary": "#242424",
        "fg": "#eeeeee",
        "fg_muted": "#aaaaaa",
        "fg_secondary": "#888888",
        "fg_tertiary": "#666666",
        "accent": "#ff9500",
        "accent_light": "#ffb74d",
        "accent_hover": "#00bcd4",
        "accent_dark": "#e65100",
        "border": "#3a3a3a",
        "blue_hover": "#29b6f6",
        "error": "#ef5350",
        "warning": "#ffa726",
        "success": "#66bb6a",
        "orange": "#ff7043",
    },
    "High Contrast": {
        "name": "High Contrast",
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
