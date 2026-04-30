"""Helpers para rutas compatibles con PyInstaller y ejecución desde fuente."""

import os
import sys
from pathlib import Path


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
    En Windows: %LOCALAPPDATA%\\COSMO
    En macOS: ~/Library/Application Support/COSMO
    En Linux: ~/.local/share/COSMO
    """
    app_name = "COSMO"
    if sys.platform == "win32":
        local = Path(os.environ.get("LOCALAPPDATA", os.path.expanduser("~"))) / app_name
    elif sys.platform == "darwin":
        local = Path.home() / "Library" / "Application Support" / app_name
    else:
        local = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / app_name

    local.mkdir(parents=True, exist_ok=True)
    return local / relative_path
