from __future__ import annotations

import base64
import time
from pathlib import Path

from backend.core.computer_use import driver
from backend.core.integrations.types import JsonObject

_KEEP_SHOTS = 12

TOOL_SPECS: list[JsonObject] = [
    {
        "name": "ui_windows",
        "gated": False,
        "module": "computer",
        "description": (
            "Equipo · ui_windows (solo lectura): enumera las ventanas visibles del escritorio con título, proceso, "
            "pid, rectángulo y si está minimizada, activa o elevada. Devuelve window_id efímeros que consumen las "
            "demás herramientas ui_*; si una acción avisa «obsoleto», vuelve a enumerar"
        ),
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "ui_observe",
        "gated": True,
        "module": "computer",
        "description": (
            "Equipo · ui_observe (efecto: requiere aprobación del usuario): observa una ventana anclado a elementos "
            "de accesibilidad (rol, nombre, automation_id, valor, centro, si es campo de contraseña) y adjunta una "
            "captura JPEG de la ventana. Devuelve element_id efímeros que consumen ui_click/ui_type/ui_set_value; "
            "tras cada acción re-observa porque los ids caducan"
        ),
        "inputSchema": {"type": "object", "properties": {
            "window_id": {"type": "string", "description": "Identificador de ui_windows"},
            "screenshot": {"type": "boolean", "description": "Adjuntar captura JPEG (por defecto sí)"},
            "max_elements": {"type": "integer", "minimum": 1, "maximum": 800, "description": "Tope de elementos (por defecto 300)"},
        }, "required": ["window_id"]},
    },
    {
        "name": "ui_click",
        "gated": True,
        "module": "computer",
        "description": (
            "Equipo · ui_click (efecto: requiere aprobación del usuario): hace clic en el centro de un elemento "
            "anclado a accesibilidad, más fiable que las coordenadas de píxeles de desktop_click"
        ),
        "inputSchema": {"type": "object", "properties": {
            "window_id": {"type": "string", "description": "Identificador de ui_windows"},
            "element_id": {"type": "string", "description": "Identificador de ui_observe"},
            "button": {"type": "string", "enum": ["left", "right", "middle"], "description": "Botón (por defecto left)"},
            "double": {"type": "boolean", "description": "Doble clic"},
        }, "required": ["window_id", "element_id"]},
    },
    {
        "name": "ui_type",
        "gated": True,
        "module": "computer",
        "description": (
            "Equipo · ui_type (efecto: requiere aprobación del usuario): teclea texto carácter a carácter en un "
            "campo, enfocándolo solo si no lo está ya. Se rechaza en campos de contraseña; para textos largos usa "
            "ui_set_value si el campo lo soporta"
        ),
        "inputSchema": {"type": "object", "properties": {
            "window_id": {"type": "string", "description": "Identificador de ui_windows"},
            "element_id": {"type": "string", "description": "Campo de texto de ui_observe"},
            "text": {"type": "string", "maxLength": 5000, "description": "Texto a teclear"},
        }, "required": ["window_id", "element_id", "text"]},
    },
    {
        "name": "ui_key",
        "gated": True,
        "module": "computer",
        "description": (
            "Equipo · ui_key (efecto: requiere aprobación del usuario): pulsa combinaciones de teclas tipo "
            "«ctrl+s», «end», «alt+f4»; hasta 4 teclas por combo. Con element_id enfoca ese elemento antes de pulsar"
        ),
        "inputSchema": {"type": "object", "properties": {
            "window_id": {"type": "string", "description": "Identificador de ui_windows"},
            "element_id": {"type": "string", "description": "Elemento de ui_observe a enfocar (opcional)"},
            "keys": {"type": "string", "description": "Combo con «+», por ejemplo «ctrl+shift+s»"},
        }, "required": ["window_id", "keys"]},
    },
    {
        "name": "ui_scroll",
        "gated": True,
        "module": "computer",
        "description": (
            "Equipo · ui_scroll (efecto: requiere aprobación del usuario): desplaza con la rueda sobre un elemento "
            "o el centro de la ventana; amount positivo hacia arriba, negativo hacia abajo, tope ±20"
        ),
        "inputSchema": {"type": "object", "properties": {
            "window_id": {"type": "string", "description": "Identificador de ui_windows"},
            "element_id": {"type": "string", "description": "Elemento de ui_observe (opcional)"},
            "amount": {"type": "integer", "minimum": -20, "maximum": 20, "description": "Muescas de rueda"},
        }, "required": ["window_id", "amount"]},
    },
    {
        "name": "ui_drag",
        "gated": True,
        "module": "computer",
        "description": (
            "Equipo · ui_drag (efecto: requiere aprobación del usuario): arrastra desde un elemento hasta otro "
            "elemento (to_element_id) o unas coordenadas de la ventana (to_x/to_y)"
        ),
        "inputSchema": {"type": "object", "properties": {
            "window_id": {"type": "string", "description": "Identificador de ui_windows"},
            "element_id": {"type": "string", "description": "Elemento origen de ui_observe"},
            "to_element_id": {"type": "string", "description": "Elemento destino de ui_observe"},
            "to_x": {"type": "number", "description": "X destino en pantalla (alternativa a to_element_id)"},
            "to_y": {"type": "number", "description": "Y destino en pantalla (alternativa a to_element_id)"},
        }, "required": ["window_id", "element_id"]},
    },
    {
        "name": "ui_set_value",
        "gated": True,
        "module": "computer",
        "description": (
            "Equipo · ui_set_value (efecto: requiere aprobación del usuario): establece el texto de un campo de "
            "golpe con el patrón Value de accesibilidad, sin teclear; más fiable que ui_type para textos largos. "
            "Se rechaza en campos de contraseña y en campos sin patrón Value"
        ),
        "inputSchema": {"type": "object", "properties": {
            "window_id": {"type": "string", "description": "Identificador de ui_windows"},
            "element_id": {"type": "string", "description": "Campo de ui_observe con patrón Value"},
            "value": {"type": "string", "maxLength": 5000, "description": "Texto a establecer"},
        }, "required": ["window_id", "element_id", "value"]},
    },
    {
        "name": "ui_launch",
        "gated": True,
        "module": "computer",
        "description": (
            "Equipo · ui_launch (efecto: requiere aprobación del usuario): abre cualquier aplicación por nombre "
            "(firefox, chrome, spotify, notepad, calc…) o ruta de programa/documento; si no encuentra el ejecutable "
            "sugiere abrirla vía shell con Start-Process; enumera con ui_windows para operar su ventana"
        ),
        "inputSchema": {"type": "object", "properties": {
            "app": {"type": "string", "description": "Nombre de la aplicación o ruta"},
            "args": {"type": "string", "description": "Argumentos, por ejemplo la ruta del documento"},
        }, "required": ["app"]},
    },
]

_ACTIONS = {
    "ui_click": "click",
    "ui_type": "type_text",
    "ui_key": "press_key",
    "ui_scroll": "scroll",
    "ui_drag": "drag",
    "ui_set_value": "set_value",
}


def _required_text(params: JsonObject, key: str, origin: str) -> str:
    value = params.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"Indica {key} de {origin}")
    return value


def _optional_text(params: JsonObject, key: str, origin: str) -> str | None:
    value = params.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value:
        raise ValueError(f"{key} debe ser texto de {origin}")
    return value


def _save_shot(shot: JsonObject, root: Path) -> JsonObject:
    folder = root.parent / f"{root.name}.screens"
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"ui-{time.time_ns()}.jpg"
    target.write_bytes(base64.b64decode(str(shot["image_b64"])))
    for old in sorted(folder.glob("*.jpg"))[:-_KEEP_SHOTS]:
        old.unlink(missing_ok=True)
    return {"path": str(target), "mime": shot.get("mime"), "width": shot.get("width"), "height": shot.get("height")}


def _observe(params: JsonObject, root: Path) -> JsonObject:
    window_id = _required_text(params, "window_id", "ui_windows")
    max_elements = params.get("max_elements", driver._MAX_ELEMENTS_DEFAULT)
    if not isinstance(max_elements, int) or isinstance(max_elements, bool) or max_elements < 1:
        raise ValueError("max_elements debe ser un entero positivo")
    state = driver.window_state(window_id, screenshot=params.get("screenshot") is not False, max_elements=max_elements)
    shot = state.pop("screenshot", None)
    if isinstance(shot, dict) and isinstance(shot.get("image_b64"), str):
        state["image"] = _save_shot(shot, root)
    return state


def run(name: str, params: JsonObject, root: Path) -> JsonObject:
    if name == "ui_windows":
        return driver.enumerate_windows()
    if name == "ui_observe":
        return _observe(params, root)
    if name == "ui_launch":
        app = _required_text(params, "app", "ui_launch")
        args = params.get("args")
        if args is not None and not isinstance(args, str):
            raise ValueError("args debe ser texto")
        return driver.launch_app(app, args)
    action = _ACTIONS.get(name)
    if action is None:
        raise ValueError(f"Herramienta no disponible para el agente: {name}")
    window_id = _required_text(params, "window_id", "ui_windows")
    element_id = _optional_text(params, "element_id", "ui_observe")
    action_params = {k: v for k, v in params.items() if k not in ("window_id", "element_id")}
    return driver.perform_action(window_id, action, element_id, action_params)
