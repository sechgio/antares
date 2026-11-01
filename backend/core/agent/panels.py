from __future__ import annotations

import json

from backend.core.integrations.types import JsonObject

TYPES = frozenset({"choice", "form", "table", "page"})
MAX_PROPS_BYTES = 200 * 1024
TOOL_SPECS: list[JsonObject] = [{
    "name": "panel_show", "module": "documents", "gated": False,
    "description": (
        "Muestra un panel interactivo dentro del chat y termina tu turno; la respuesta llega como mensaje del usuario "
        "con [panel:<id>]. type=choice: props {prompt, options:[string]}. type=form: props {title?, submit_label?, "
        "fields:[{name, label, type: text|number|textarea|select|checkbox, options?, required?}]}. type=table: props "
        "{title?, columns:[string], rows:[[string|number|null]]}, solo lectura con filtro. Para páginas usa page_create."
    ),
    "inputSchema": {"type": "object", "additionalProperties": False, "properties": {
        "type": {"type": "string", "enum": ["choice", "form", "table"]},
        "props": {"type": "object"},
    }, "required": ["type", "props"]},
}]


def validate(panel: object) -> JsonObject:
    if not isinstance(panel, dict) or panel.get("type") not in TYPES or not isinstance(panel.get("props"), dict):
        raise ValueError("El panel necesita type (choice, form, table o page) y props como objeto")
    if len(json.dumps(panel["props"], ensure_ascii=False, default=str).encode("utf-8")) > MAX_PROPS_BYTES:
        raise ValueError("Las props del panel superan 200 KiB")
    return {"type": panel["type"], "props": panel["props"]}


def response_message(panel: JsonObject, response: object) -> str:
    if panel["type"] == "choice":
        if not isinstance(response, dict) or not isinstance(response.get("choice"), str) or not response["choice"].strip():
            raise ValueError("Elige una opción")
        return f"[panel:{panel['id']}] Opción elegida: {response['choice']}"
    if panel["type"] == "form":
        values = response.get("values") if isinstance(response, dict) else None
        if not isinstance(values, dict) or any(not isinstance(key, str) for key in values):
            raise ValueError("El formulario necesita valores")
        lines = [f"- {key}: {json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value}"
                 for key, value in values.items()]
        return "\n".join([f"[panel:{panel['id']}] Formulario enviado:", *lines])
    raise ValueError("Este panel no admite respuestas")
