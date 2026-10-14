from __future__ import annotations

from backend.core.integrations.types import JsonObject

TOOL_SPECS: list[JsonObject] = [{"name": "ask_user", "module": "documents", "gated": False,
    "description": "Preguntar sólo los datos o decisiones que faltan; espera una respuesta explícita del usuario en una tarjeta",
    "inputSchema": {"type": "object", "properties": {"questions": {"type": "array", "minItems": 1, "maxItems": 3,
        "items": {"type": "object", "properties": {"id": {"type": "string"}, "prompt": {"type": "string"},
            "options": {"type": "array", "items": {"type": "string"}, "maxItems": 10}}, "required": ["id", "prompt"]}}},
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
        if not isinstance(key, str) or not key or len(key) > 80 or key in ids:
            raise ValueError("ID de pregunta inválido o duplicado")
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 1000:
            raise ValueError("Texto de pregunta inválido")
        if not isinstance(options, list) or len(options) > 10 or any(not isinstance(value, str) or len(value) > 200 for value in options):
            raise ValueError("Opciones de pregunta inválidas")
        ids.add(key)
    return questions
