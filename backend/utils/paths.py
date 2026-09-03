
from __future__ import annotations

import os
import sys
from pathlib import Path

_config_path_cache: dict[str, Path] = {}


def resource_path(relative_path: str) -> Path:
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            base = Path(meipass)
        else:
            base = Path(sys.executable).resolve().parent
            internal = base / "_internal"
            if internal.is_dir():
                base = internal
    else:
        base = Path(__file__).resolve().parent.parent.parent
    return base / relative_path


def user_data_path(relative_path: str) -> Path:
    app_name = "Antares"
    if sys.platform == "win32":
        local = Path(os.environ.get("LOCALAPPDATA", os.path.expanduser("~"))) / app_name
    elif sys.platform == "darwin":
        local = Path.home() / "Library" / "Application Support" / app_name
    else:
        local = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / app_name

    local.mkdir(parents=True, exist_ok=True)
    return local / relative_path


def cached_config_path(key: str, filename: str) -> Path:
    cached = _config_path_cache.get(key)
    if cached is None:
        cached = user_data_path(filename)
        _config_path_cache[key] = cached
    return cached
