from __future__ import annotations

import base64

import pytest

from backend.core.agent import agent_tools, computer_elements
from backend.core.computer_use import driver, policy


def test_specs_are_registered_with_policy_classes():
    assert "ui_windows" in agent_tools.READ_TOOLS
    gated = {
        "ui_observe", "ui_click", "ui_type", "ui_key", "ui_scroll", "ui_drag", "ui_set_value", "ui_launch",
    }
    assert gated <= agent_tools.EFFECT_TOOLS
    for name in ("ui_windows", *gated):
        assert agent_tools.SPECS[name]["module"] == "computer"


def test_ui_windows_delegates_to_driver(monkeypatch):
    calls = []

    def fake_enumerate():
        calls.append(1)
        return {"windows": [], "note": "ok"}

    monkeypatch.setattr(driver, "enumerate_windows", fake_enumerate)
    assert computer_elements.run("ui_windows", {}, None) == {"windows": [], "note": "ok"}
    assert calls == [1]


def test_ui_observe_writes_screenshot_file(monkeypatch, tmp_path):
    shot_b64 = base64.b64encode(b"jpeg-bytes").decode("ascii")

    def fake_state(window_id, screenshot=True, max_elements=300):
        assert window_id == "wabc" and screenshot is True and max_elements == 300
        return {"window": {}, "generation": 1, "elements": [], "truncated": False, "note": "",
                "screenshot": {"image_b64": shot_b64, "mime": "image/jpeg", "width": 40, "height": 20}}

    monkeypatch.setattr(driver, "window_state", fake_state)
    root = tmp_path / "session-1"
    root.mkdir()
    result = computer_elements.run("ui_observe", {"window_id": "wabc"}, root)
    assert "screenshot" not in result
    image = result["image"]
    assert image["mime"] == "image/jpeg" and image["width"] == 40 and image["height"] == 20
    saved = tmp_path / "session-1.screens" / image["path"].replace("\\", "/").split("/")[-1]
    assert saved.read_bytes() == b"jpeg-bytes"


def test_ui_observe_without_screenshot_has_no_image(monkeypatch, tmp_path):
    def fake_state(window_id, screenshot=True, max_elements=300):
        assert screenshot is False
        return {"window": {}, "generation": 1, "elements": [], "truncated": False, "note": ""}

    monkeypatch.setattr(driver, "window_state", fake_state)
    root = tmp_path / "session-2"
    root.mkdir()
    result = computer_elements.run("ui_observe", {"window_id": "wabc", "screenshot": False}, root)
    assert "image" not in result


def test_ui_observe_requires_window_id():
    with pytest.raises(ValueError, match="window_id"):
        computer_elements.run("ui_observe", {}, None)


@pytest.mark.parametrize("name,action", [
    ("ui_click", "click"),
    ("ui_type", "type_text"),
    ("ui_key", "press_key"),
    ("ui_scroll", "scroll"),
    ("ui_drag", "drag"),
    ("ui_set_value", "set_value"),
])
def test_action_tools_map_to_driver_actions(monkeypatch, name, action):
    seen = {}

    def fake_perform(window_id, action_name, element_id, params):
        seen.update(window_id=window_id, action=action_name, element_id=element_id, params=params)
        return {"action": action_name, "performed": True}

    monkeypatch.setattr(driver, "perform_action", fake_perform)
    params = {"window_id": "w1", "element_id": "e2", "text": "hola"}
    if name in ("ui_scroll", "ui_drag"):
        params = {"window_id": "w1", "element_id": "e2", "amount": 3, "to_x": 1, "to_y": 2}
    computer_elements.run(name, params, None)
    assert seen == {"window_id": "w1", "action": action, "element_id": "e2",
                    "params": {k: v for k, v in params.items() if k not in ("window_id", "element_id")}}


def test_ui_key_without_element_passes_none(monkeypatch):
    seen = {}

    def fake_perform(window_id, action_name, element_id, params):
        seen.update(element_id=element_id, params=params)
        return {"action": action_name, "performed": True}

    monkeypatch.setattr(driver, "perform_action", fake_perform)
    computer_elements.run("ui_key", {"window_id": "w1", "keys": "ctrl+s"}, None)
    assert seen == {"element_id": None, "params": {"keys": "ctrl+s"}}


def test_ui_launch_validates_and_delegates(monkeypatch):
    seen = {}

    def fake_launch(app, args=None):
        seen.update(app=app, args=args)
        return {"pid": 42, "policy": {"category": policy.ALWAYS_CONFIRM}}

    monkeypatch.setattr(driver, "launch_app", fake_launch)
    result = computer_elements.run("ui_launch", {"app": "notepad", "args": "C:/x.txt"}, None)
    assert result["pid"] == 42 and seen == {"app": "notepad", "args": "C:/x.txt"}
    with pytest.raises(ValueError, match="args"):
        computer_elements.run("ui_launch", {"app": "notepad", "args": 5}, None)


def test_handoff_from_driver_propagates_clean(monkeypatch):
    def refused(window_id, action_name, element_id, params):
        raise policy.DriverRefused("No se opera sobre campos de contraseña")

    monkeypatch.setattr(driver, "perform_action", refused)
    with pytest.raises(policy.DriverRefused):
        computer_elements.run("ui_type", {"window_id": "w1", "element_id": "e1", "text": "x"}, None)


def test_unknown_ui_tool_is_rejected():
    with pytest.raises(ValueError, match="no disponible"):
        computer_elements.run("ui_reboot", {}, None)
