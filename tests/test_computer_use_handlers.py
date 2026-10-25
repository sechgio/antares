from __future__ import annotations

import pytest

from backend.handlers import computer_use as handlers


def test_window_state_requires_window_id():
    with pytest.raises(ValueError, match="window_id"):
        handlers.computer_use_window_state({})


def test_window_state_rejects_bad_max_elements():
    with pytest.raises(ValueError, match="max_elements"):
        handlers.computer_use_window_state({"window_id": "w1", "max_elements": 0})
    with pytest.raises(ValueError, match="max_elements"):
        handlers.computer_use_window_state({"window_id": "w1", "max_elements": True})


def test_action_requires_window_id_and_action():
    with pytest.raises(ValueError, match="window_id"):
        handlers.computer_use_action({})
    with pytest.raises(ValueError, match="acción"):
        handlers.computer_use_action({"window_id": "w1"})


def test_action_rejects_bad_element_id_and_params():
    with pytest.raises(ValueError, match="element_id"):
        handlers.computer_use_action({"window_id": "w1", "action": "click", "element_id": ""})
    with pytest.raises(ValueError, match="params"):
        handlers.computer_use_action({"window_id": "w1", "action": "click", "params": "x"})


def test_launch_app_requires_app_and_string_args():
    with pytest.raises(ValueError, match="aplicación"):
        handlers.computer_use_launch_app({})
    with pytest.raises(ValueError, match="args"):
        handlers.computer_use_launch_app({"app": "notepad", "args": 5})


def test_handlers_registry_exposes_catalog_names():
    assert set(handlers.HANDLERS) == {
        "computer_use_enumerate",
        "computer_use_window_state",
        "computer_use_action",
        "computer_use_launch_app",
    }
