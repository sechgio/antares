from __future__ import annotations

import pytest

from backend.core.computer_use import policy


def test_read_only_and_act_classification():
    for action in ("click", "type_text", "press_key", "scroll", "drag", "set_value"):
        assert policy.classify_action(action) == {"category": policy.ACT, "reason": ""}


def test_unknown_action_is_rejected():
    with pytest.raises(ValueError):
        policy.classify_action("rm_rf")


def test_password_target_handoff():
    for action in ("type_text", "set_value"):
        result = policy.classify_action(action, target_password=True)
        assert result["category"] == policy.HANDOFF
        assert "contraseña" in result["reason"]


def test_click_on_password_field_is_allowed():
    result = policy.classify_action("click", target_password=True)
    assert result["category"] == policy.ACT


def test_elevated_window_handoff():
    result = policy.classify_action("click", window_elevated=True)
    assert result["category"] == policy.HANDOFF
    assert "elevado" in result["reason"]
    assert policy.classify_action("type_text", window_elevated=True, target_password=True)["category"] == policy.HANDOFF


def test_launch_is_always_confirm():
    assert policy.classify_launch() == {"category": policy.ALWAYS_CONFIRM, "reason": policy.classify_launch()["reason"]}
    assert "confirmación" in policy.classify_launch()["reason"]


def test_driver_refused_is_a_value_error():
    assert issubclass(policy.DriverRefused, ValueError)


def test_parse_keys_valid():
    assert policy.parse_keys("ctrl+s") == [["ctrl", "s"]]
    assert policy.parse_keys("enter") == [["enter"]]
    assert policy.parse_keys("ctrl+alt+del tab") == [["ctrl", "alt", "del"], ["tab"]]
    assert policy.parse_keys("  F5  ") == [["f5"]]


@pytest.mark.parametrize("keys", ["", None, 42, "ctrl+!", "a+b+c+d+e", " ".join(["enter"] * 9), "x" * 90])
def test_parse_keys_invalid(keys):
    with pytest.raises(ValueError):
        policy.parse_keys(keys)
