from __future__ import annotations

import subprocess
import sys
import time

import pytest

from backend.core.computer_use import driver, policy
from backend.core.computer_use.targets import DriverError

# Estos tests abren Notepad real: hay que ejecutarlos en serie (-n0) porque
# Win11 Notepad fusiona instancias en pestañas de una misma ventana y dos
# lanzamientos en paralelo se roban el foco y el título entre sí.
pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(sys.platform != "win32", reason="computer-use solo existe en Windows"),
]


def _wait_for_window(token: str, timeout_s: float = 15.0) -> tuple[dict, dict]:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        data = driver.enumerate_windows()
        for window in data["windows"]:
            if token in str(window["title"]).lower() and window["process"] == "notepad.exe":
                return data, window
        time.sleep(0.5)
    raise AssertionError(f"La ventana de prueba con «{token}» no apareció")


def _editable(state: dict) -> dict | None:
    for entry in state["elements"]:
        if entry["role"] in ("edit", "document") and entry.get("enabled", True) and not entry.get("is_password"):
            return entry
    return None


def test_driver_operates_real_notepad(tmp_path):
    scratch = tmp_path / "prueba-computer-use.txt"
    scratch.write_text("", encoding="utf-8")
    token = scratch.name.lower()
    launch = driver.launch_app("notepad", args=str(scratch))
    assert launch["policy"]["category"] == policy.ALWAYS_CONFIRM
    pid = None
    try:
        _data, window = _wait_for_window(token)
        pid = window["pid"]
        state = driver.window_state(str(window["window_id"]), screenshot=True)
        assert state["elements"], "el árbol de accesibilidad de Notepad está vacío"
        assert state["screenshot"] is not None and state["screenshot"]["mime"] == "image/jpeg"
        target = _editable(state)
        assert target is not None, "Notepad sin campo de edición visible"

        driver.perform_action(str(window["window_id"]), "click", str(target["element_id"]), {})
        text = "hola mundo 1234"
        driver.perform_action(str(window["window_id"]), "type_text", str(target["element_id"]), {"text": text})

        state2 = driver.window_state(str(window["window_id"]))
        target2 = _editable(state2)
        assert target2 is not None
        assert str(target2.get("value", "")).startswith(text)

        driver.perform_action(str(window["window_id"]), "set_value", str(target2["element_id"]), {"value": "reemplazado"})
        state3 = driver.window_state(str(window["window_id"]))
        target3 = _editable(state3)
        assert target3 is not None and str(target3.get("value", "")) == "reemplazado"

        driver.perform_action(str(window["window_id"]), "press_key", None, {"keys": "end"})
    finally:
        if pid:
            subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True, check=False)


def test_missing_executable_suggests_start_process():
    with pytest.raises(DriverError, match="Start-Process"):
        driver.launch_app("antares-app-inexistente-xyz")


def test_stale_element_raises_driver_error(tmp_path):
    scratch = tmp_path / "prueba-stale.txt"
    scratch.write_text("", encoding="utf-8")
    token = scratch.name.lower()
    pid = None
    try:
        driver.launch_app("notepad", args=str(scratch))
        _data, window = _wait_for_window(token)
        pid = window["pid"]
        driver.window_state(str(window["window_id"]))
        with pytest.raises(ValueError):
            driver.perform_action(str(window["window_id"]), "click", "e99999", {})
    finally:
        if pid:
            subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True, check=False)
