"""Helpers para rutas compatibles con PyInstaller y ejecución desde fuente."""

from __future__ import annotations

import os
import sys
from pathlib import Path

_config_path_cache: dict[str, Path] = {}


def resource_path(relative_path: str) -> Path:
    """
    Resuelve la ruta absoluta a un recurso empaquetado.
    En ejecución desde fuente usa la ruta del módulo.
    En PyInstaller onefile usa sys._MEIPASS (directorio temporal de extracción).
    """
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        base = Path(sys._MEIPASS)
    else:
        base = Path(__file__).resolve().parent.parent.parent
    return base / relative_path


def user_data_path(relative_path: str) -> Path:
    """
    Resuelve una ruta writable para datos de usuario (BD, logs, etc.).
    En Windows: %LOCALAPPDATA%\\ANTARES
    En macOS: ~/Library/Application Support/ANTARES
    En Linux: ~/.local/share/ANTARES
    """
    app_name = "ANTARES"
    if sys.platform == "win32":
        local = Path(os.environ.get("LOCALAPPDATA", os.path.expanduser("~"))) / app_name
    elif sys.platform == "darwin":
        local = Path.home() / "Library" / "Application Support" / app_name
    else:
        local = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / app_name

    local.mkdir(parents=True, exist_ok=True)
    return local / relative_path


def cached_config_path(key: str, filename: str) -> Path:
    """Return and cache a user-data path for a config file.

    Avoids repeated filesystem resolution for the same config file.
    The *key* is a unique identifier (e.g. 'fields', 'patterns', 'theme').
    """
    cached = _config_path_cache.get(key)
    if cached is None:
        cached = user_data_path(filename)
        _config_path_cache[key] = cached
    return cached
