from __future__ import annotations

from backend.core.integrations.types import JsonObject

TOOL_SPECS: list[JsonObject] = [{"name": "ask_user", "module": "documents", "gated": False,
    "description": "Pregunta sólo los datos o decisiones que faltan y espera la respuesta en una tarjeta; multiSelect permite varias respuestas",
    "inputSchema": {"type": "object", "properties": {"questions": {"type": "array", "minItems": 1, "maxItems": 3,
        "items": {"type": "object", "properties": {"id": {"type": "string"}, "prompt": {"type": "string"},
            "header": {"type": "string", "maxLength": 40},
            "multiSelect": {"type": "boolean"},
            "options": {"type": "array", "maxItems": 10, "items": {"type": "object",
                "properties": {"label": {"type": "string"}, "description": {"type": "string"}}, "required": ["label"]}}},
            "required": ["id", "prompt"]}}},
        "required": ["questions"]}}]


def validate(params: JsonObject) -> list[JsonObject]:
    questions = params.get("questions")
    if not isinstance(questions, list) or not 1 <= len(questions) <= 3:
        raise ValueError("Formula entre una y tres preguntas")
    ids: set[str] = set()
    for question in questions:
        if not isinstance(question, dict):
            raise ValueError("Pregunta inválida")
        key, prompt = question.get("id"), question.get("prompt")
        options = question.get("options", [])
        header = question.get("header")
        multi = question.get("multiSelect", False)
        if not isinstance(key, str) or not key or len(key) > 80 or key in ids:
            raise ValueError("ID de pregunta inválido o duplicado")
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 1000:
            raise ValueError("Texto de pregunta inválido")
        if header is not None and (not isinstance(header, str) or len(header) > 40):
            raise ValueError("Encabezado de pregunta inválido")
        if not isinstance(multi, bool):
            raise ValueError("multiSelect debe ser verdadero o falso")
        if not isinstance(options, list) or len(options) > 10:
            raise ValueError("Opciones de pregunta inválidas")
        normalized: list[str | dict[str, str]] = []
        for value in options:
            if isinstance(value, str):
                if not value.strip() or len(value) > 200:
                    raise ValueError("Opciones de pregunta inválidas")
                normalized.append(value)
                continue
            if isinstance(value, dict):
                label, description = value.get("label"), value.get("description")
                if not isinstance(label, str) or not label.strip() or len(label) > 200:
                    raise ValueError("Opciones de pregunta inválidas")
                if description is not None and (not isinstance(description, str) or len(description) > 300):
                    raise ValueError("Descripción de opción inválida")
                normalized.append({"label": label, **({"description": description} if isinstance(description, str) and description else {})})
                continue
            raise ValueError("Opciones de pregunta inválidas")
        question["options"] = normalized
        if multi is False:
            question.pop("multiSelect", None)
        ids.add(key)
    return questions
