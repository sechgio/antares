from __future__ import annotations

import json

from backend.core.integrations.types import JsonObject
from backend.utils.paths import resource_path

_CONTRACT = json.loads(resource_path("shared/agent-plan.json").read_text(encoding="utf-8"))
_STATUSES = tuple(_CONTRACT["statuses"])
_MAX_STEPS = int(_CONTRACT["max_steps"])
_MAX_TITLE_CHARS = int(_CONTRACT["max_title_chars"])
_MAX_EVIDENCE_CHARS = int(_CONTRACT["max_evidence_chars"])

TOOL_SPECS: list[JsonObject] = [
    {
        "name": "task_plan",
        "gated": False,
        "module": "plan",
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
        evidence = str(item.get("evidence") or "").strip()
        if status == "done" and not evidence:
            raise ValueError(f"Indica la evidencia que comprueba «{item['title']}» antes de marcarlo como hecho")
        step: JsonObject = {"title": str(item["title"]).strip()[:_MAX_TITLE_CHARS], "status": status}
        if evidence:
            step["evidence"] = evidence[:_MAX_EVIDENCE_CHARS]
        steps.append(step)
    remaining = [s["title"] for s in steps if s["status"] in {"pending", "in_progress"}]
    failed = [s["title"] for s in steps if s["status"] == "failed"]
    result: JsonObject = {"recorded": True, "plan": {"goal": goal, "steps": steps},
                          "done": len(steps) - len(remaining) - len(failed),
                          "total": len(steps), "remaining": remaining}
    if failed:
        result["failed"] = failed
        result["next"] = "Corrige o replantea los pasos fallidos antes de terminar"
    elif remaining:
        result["next"] = f"Sigue con: {remaining[0]}"
    else:
        result["next"] = "Todos los pasos tienen evidencia: comprueba el objetivo una última vez y resume el resultado"
    return result
