from __future__ import annotations

import sys
from pathlib import Path

import backend.utils.paths as paths


def test_resource_path_dev_apunta_a_raiz_del_repo() -> None:
    base = paths.resource_path("formatos")
    assert base.name == "formatos"
    assert (base.parent / "backend").is_dir()


def test_resource_path_frozen_con_meipass(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    assert paths.resource_path("x.txt") == tmp_path / "x.txt"


def test_resource_path_frozen_sin_meipass_usa_internal(monkeypatch, tmp_path) -> None:
    exe_dir = tmp_path / "dist"
    internal = exe_dir / "_internal"
    internal.mkdir(parents=True)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)
    monkeypatch.setattr(sys, "executable", str(exe_dir / "app.exe"))
    assert paths.resource_path("x.txt") == internal / "x.txt"


def test_user_data_path_windows_usa_localappdata(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    result = paths.user_data_path("canvas")
    assert result == tmp_path / "Antares" / "canvas"
    assert (tmp_path / "Antares").is_dir()


def test_user_data_path_darwin_y_linux(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(Path, "home", staticmethod(lambda: tmp_path))
    monkeypatch.setattr(sys, "platform", "darwin")
    assert paths.user_data_path("f") == tmp_path / "Library" / "Application Support" / "Antares" / "f"

    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.delenv("XDG_DATA_HOME", raising=False)
    assert paths.user_data_path("f") == tmp_path / ".local" / "share" / "Antares" / "f"

    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "xdg"))
    assert paths.user_data_path("f") == tmp_path / "xdg" / "Antares" / "f"


def test_cached_config_path_memoiza_por_clave(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    paths._config_path_cache.clear()

    first = paths.cached_config_path("k1", "cfg.json")
    second = paths.cached_config_path("k1", "otro.json")
    assert first == second  # segunda llamada ignora filename
    other = paths.cached_config_path("k2", "cfg2.json")
    assert other != first
