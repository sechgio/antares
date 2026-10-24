from __future__ import annotations

import pytest

from backend.core.computer_use.targets import DriverError, TargetCache


def _window(window_id: str = "w1a2b", title: str = "Documento - Bloc de notas") -> dict:
    return {"window_id": window_id, "title": title, "pid": 42, "process": "notepad.exe",
            "rect": [10, 20, 800, 600], "minimized": False, "active": True, "elevated": False}


def _element(element_id: str, runtime_id: str) -> dict:
    return {"element_id": element_id, "runtime_id": runtime_id, "role": "edit", "name": "Editor",
            "rect": [12, 40, 780, 560], "center": [400, 300], "enabled": True, "is_password": False}


def test_remember_windows_increments_generation_and_caches():
    cache = TargetCache()
    gen1 = cache.remember_windows([_window()])
    gen2 = cache.remember_windows([_window()])
    assert gen2 == gen1 + 1
    assert cache.window("w1a2b")["title"].endswith("Bloc de notas")


def test_unknown_window_raises_with_recovery_hint():
    cache = TargetCache()
    with pytest.raises(DriverError, match="computer_use_enumerate"):
        cache.window("wdead")


def test_elements_require_window_state_first():
    cache = TargetCache()
    cache.remember_windows([_window()])
    with pytest.raises(DriverError, match="window_state"):
        cache.element("w1a2b", "e0")


def test_remember_elements_rejects_stale_generation():
    cache = TargetCache()
    gen = cache.remember_windows([_window()])
    cache.remember_windows([_window()])
    with pytest.raises(DriverError, match="enumeración"):
        cache.remember_elements("w1a2b", gen, [_element("e0", "1,2,3")])


def test_element_lookup_and_fresh_check():
    cache = TargetCache()
    cache.remember_windows([_window()])
    cache.remember_elements("w1a2b", cache.generation, [_element("e0", "1,2,3")])
    fresh = {"1,2,3": _element("e9", "1,2,3")}
    assert cache.check_element("w1a2b", "e0", fresh)["element_id"] == "e9"
    with pytest.raises(DriverError, match="obsoleto"):
        cache.check_element("w1a2b", "e0", {"9,9,9": _element("e9", "9,9,9")})


def test_new_enumeration_drops_old_elements():
    cache = TargetCache()
    cache.remember_windows([_window()])
    cache.remember_elements("w1a2b", cache.generation, [_element("e0", "1,2,3")])
    cache.remember_windows([_window()])
    with pytest.raises(DriverError, match="window_state"):
        cache.element("w1a2b", "e0")


def test_check_window_detects_closed_window():
    cache = TargetCache()
    cache.remember_windows([_window()])
    with pytest.raises(DriverError, match="ya no existe"):
        cache.check_window("w1a2b", alive=False)
