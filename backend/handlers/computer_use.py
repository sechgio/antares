from __future__ import annotations

from backend.core.computer_use import driver
from backend.core.integrations.types import JsonObject


def computer_use_enumerate(params: JsonObject) -> JsonObject:
    return driver.enumerate_windows()


def computer_use_window_state(params: JsonObject) -> JsonObject:
    window_id = params.get("window_id")
    if not isinstance(window_id, str) or not window_id:
        raise ValueError("Indica window_id de una enumeración previa")
    max_elements = params.get("max_elements", driver._MAX_ELEMENTS_DEFAULT)
    if not isinstance(max_elements, int) or isinstance(max_elements, bool) or max_elements < 1:
        raise ValueError("max_elements debe ser un entero positivo")
    return driver.window_state(window_id, screenshot=params.get("screenshot") is True, max_elements=max_elements)


def computer_use_action(params: JsonObject) -> JsonObject:
    window_id = params.get("window_id")
    action = params.get("action")
    if not isinstance(window_id, str) or not window_id:
        raise ValueError("Indica window_id de una enumeración previa")
    if not isinstance(action, str) or not action:
        raise ValueError("Indica la acción a realizar")
    element_id = params.get("element_id")
    if element_id is not None and (not isinstance(element_id, str) or not element_id):
        raise ValueError("element_id debe ser texto de una observación previa")
    action_params = params.get("params") or {}
    if not isinstance(action_params, dict):
        raise ValueError("params debe ser un objeto")
    return driver.perform_action(window_id, action, element_id, action_params)


def computer_use_launch_app(params: JsonObject) -> JsonObject:
    app = params.get("app")
    if not isinstance(app, str) or not app:
        raise ValueError("Indica la aplicación a abrir")
    args = params.get("args")
    if args is not None and not isinstance(args, str):
        raise ValueError("args debe ser texto")
    return driver.launch_app(app, args)


HANDLERS = {
    "computer_use_enumerate": computer_use_enumerate,
    "computer_use_window_state": computer_use_window_state,
    "computer_use_action": computer_use_action,
    "computer_use_launch_app": computer_use_launch_app,
}
