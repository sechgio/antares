from __future__ import annotations

from backend.core.integrations.types import JsonObject

_STATUSES = ("pending", "in_progress", "done", "failed")
_MAX_STEPS = 20

TOOL_SPECS: list[JsonObject] = [
    {
        "name": "task_plan",
        "gated": False,
        "module": "computer",
        "description": (
            "Plan · task_plan (sin efectos): publica o actualiza el plan visible del encargo. Envía siempre la lista "
            "completa de pasos; marca un paso «done» solo con la evidencia observada que lo comprueba"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "goal": {"type": "string", "description": "Objetivo verificable del encargo"},
                "steps": {
                    "type": "array",
                    "maxItems": _MAX_STEPS,
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "status": {"type": "string", "enum": list(_STATUSES)},
                            "evidence": {"type": "string", "description": "Qué observaste que demuestra el estado"},
                        },
                        "required": ["title", "status"],
                    },
                },
            },
            "required": ["goal", "steps"],
        },
    },
]


def update(params: JsonObject) -> JsonObject:
    goal = str(params.get("goal") or "").strip()
    raw = params.get("steps")
    if not goal or not isinstance(raw, list) or not raw:
        raise ValueError("Indica el objetivo y al menos un paso")
    if len(raw) > _MAX_STEPS:
        raise ValueError(f"El plan admite hasta {_MAX_STEPS} pasos")
    steps = []
    for item in raw:
        if not isinstance(item, dict) or not str(item.get("title") or "").strip():
            raise ValueError("Cada paso necesita un título")
        status = str(item.get("status") or "pending")
        if status not in _STATUSES:
            raise ValueError(f"Estado no válido: {status}")
        if status == "done" and not str(item.get("evidence") or "").strip():
            raise ValueError(f"Indica la evidencia que comprueba «{item['title']}» antes de marcarlo como hecho")
        steps.append({"title": str(item["title"]).strip()[:160], "status": status})
    remaining = [s["title"] for s in steps if s["status"] in {"pending", "in_progress"}]
    failed = [s["title"] for s in steps if s["status"] == "failed"]
    result: JsonObject = {"recorded": True, "done": len(steps) - len(remaining) - len(failed),
                          "total": len(steps), "remaining": remaining}
    if failed:
        result["failed"] = failed
        result["next"] = "Corrige o replantea los pasos fallidos antes de terminar"
    elif remaining:
        result["next"] = f"Sigue con: {remaining[0]}"
    else:
        result["next"] = "Todos los pasos tienen evidencia: comprueba el objetivo una última vez y resume el resultado"
    return result
