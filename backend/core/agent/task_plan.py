from __future__ import annotations

import unicodedata

from backend.core.integrations.types import JsonObject

_STATUSES = ("pending", "in_progress", "done", "failed")
_MAX_STEPS = 20
_MAX_ID = 64
_MAX_DEPENDENCIES = 20

TOOL_SPECS: list[JsonObject] = [
    {
        "name": "task_plan",
        "gated": False,
        "module": "computer",
        "description": (
            "Plan · task_plan (sin efectos): publica o actualiza el plan visible del encargo. Envía siempre la lista "
            "completa de pasos; usa ids estables y dependencies para los pasos que deben estar «done» antes de empezar. "
            "Mantén un solo paso «in_progress» y marca un paso «done» solo con la evidencia observada que lo comprueba"
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
                            "id": {
                                "type": "string",
                                "description": "Identificador estable del paso; si lo omites se deriva del título",
                            },
                            "title": {"type": "string"},
                            "status": {"type": "string", "enum": list(_STATUSES)},
                            "evidence": {"type": "string", "description": "Qué observaste que demuestra el estado"},
                            "dependencies": {
                                "type": "array",
                                "maxItems": _MAX_DEPENDENCIES,
                                "items": {"type": "string"},
                                "description": "Ids o títulos de pasos que deben estar «done» antes de empezar",
                            },
                        },
                        "required": ["title", "status"],
                    },
                },
            },
            "required": ["goal", "steps"],
        },
    },
]


def _slug(title: str, index: int) -> str:
    plain = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii")
    slug = "-".join(part for part in "".join(ch.lower() if ch.isalnum() else "-" for ch in plain).split("-") if part)
    return slug[:_MAX_ID].strip("-") or f"paso-{index + 1}"


def _parse_steps(raw: list) -> tuple[list[JsonObject], dict[str, int], dict[str, int | None]]:
    steps: list[JsonObject] = []
    by_id: dict[str, int] = {}
    by_title: dict[str, int | None] = {}
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError("Cada paso necesita un título")
        title = str(item.get("title") or "").strip()
        if not title:
            raise ValueError("Cada paso necesita un título")
        title = title[:160]
        status = str(item.get("status") or "pending")
        if status not in _STATUSES:
            raise ValueError(f"Estado no válido: {status}")
        if status == "done" and not str(item.get("evidence") or "").strip():
            raise ValueError(f"Indica la evidencia que comprueba «{title}» antes de marcarlo como hecho")
        step_id = str(item.get("id") or "").strip()[:_MAX_ID] or _slug(title, index)
        key = step_id.casefold()
        if key in by_id:
            raise ValueError(f"El identificador «{step_id}» está repetido en el plan")
        raw_dependencies = item.get("dependencies")
        if raw_dependencies is None:
            raw_dependencies = []
        if not isinstance(raw_dependencies, list):
            raise ValueError(f"Las dependencias de «{title}» deben ser una lista de ids o títulos")
        if len(raw_dependencies) > _MAX_DEPENDENCIES:
            raise ValueError(f"«{title}» admite hasta {_MAX_DEPENDENCIES} dependencias")
        dependencies = []
        for dependency in raw_dependencies:
            dependency_id = str(dependency or "").strip()
            if not dependency_id:
                raise ValueError(f"La dependencia vacía de «{title}» no es válida")
            dependencies.append(dependency_id)
        title_key = title.casefold()
        by_title[title_key] = None if title_key in by_title else index
        by_id[key] = index
        steps.append({"id": step_id, "title": title, "status": status, "dependencies": dependencies})
    return steps, by_id, by_title


def _resolve_dependencies(
    steps: list[JsonObject], by_id: dict[str, int], by_title: dict[str, int | None],
) -> list[list[int]]:
    resolved: list[list[int]] = []
    for index, step in enumerate(steps):
        targets: list[int] = []
        for dependency in step["dependencies"]:
            key = dependency.casefold()
            target_id = by_id.get(key)
            title_target = by_title.get(key)
            if key in by_title and title_target is None and target_id is None:
                raise ValueError(
                    f"La dependencia «{dependency}» de «{step['title']}» es ambigua porque varios pasos se titulan así; "
                    "usa el id del paso"
                )
            if target_id is not None and title_target is not None and target_id != title_target:
                raise ValueError(
                    f"La dependencia «{dependency}» de «{step['title']}» es ambigua; usa el id del paso"
                )
            target = target_id if target_id is not None else title_target
            if target is None:
                raise ValueError(f"El paso «{step['title']}» depende de «{dependency}», que no existe en el plan")
            if target == index:
                raise ValueError(f"El paso «{step['title']}» no puede depender de sí mismo")
            if target not in targets:
                targets.append(target)
        resolved.append(targets)
    return resolved


def _reject_cycles(steps: list[JsonObject], resolved: list[list[int]]) -> None:
    state = [0] * len(steps)

    def visit(node: int, path: list[int]) -> None:
        if state[node] == 1:
            start = path.index(node)
            cycle = " → ".join(steps[item]["id"] for item in [*path[start:], node])
            raise ValueError(f"El plan tiene dependencias circulares: {cycle}")
        if state[node] == 2:
            return
        state[node] = 1
        for dependency in resolved[node]:
            visit(dependency, [*path, node])
        state[node] = 2

    for index in range(len(steps)):
        visit(index, [])


def _result(steps: list[JsonObject], resolved: list[list[int]]) -> JsonObject:
    titles = {step["id"]: step["title"] for step in steps}
    done_ids = {step["id"] for step in steps if step["status"] == "done"}
    remaining = [step for step in steps if step["status"] in {"pending", "in_progress"}]
    failed = [step for step in steps if step["status"] == "failed"]
    in_progress = [step for step in remaining if step["status"] == "in_progress"]
    resolved_by_id = {
        step["id"]: [steps[dependency]["id"] for dependency in dependencies]
        for step, dependencies in zip(steps, resolved, strict=True)
    }
    ready: list[str] = []
    blocked: list[JsonObject] = []
    for step in remaining:
        waiting = [dependency for dependency in resolved_by_id[step["id"]] if dependency not in done_ids]
        if waiting:
            blocked.append({"title": step["title"], "waiting_for": [titles[dependency] for dependency in waiting]})
        else:
            ready.append(step["title"])

    if failed:
        next_step = failed[0]["title"]
        next_text = "Corrige o replantea los pasos fallidos antes de terminar"
    elif in_progress:
        next_step = in_progress[0]["title"]
        if len(in_progress) > 1:
            next_text = (
                f"Mantén un solo paso in_progress; ahora hay {len(in_progress)}: "
                + ", ".join(step["title"] for step in in_progress)
            )
        else:
            next_text = f"Sigue con: {next_step}"
    elif ready:
        next_step = ready[0]
        next_text = f"Sigue con: {next_step}"
    elif remaining:
        next_step = remaining[0]["title"]
        waiting = next((item["waiting_for"] for item in blocked if item["title"] == next_step), [])
        next_text = (
            f"«{next_step}» espera a: {', '.join(waiting)}. Completa o replantea lo que falta."
            if waiting else f"Sigue con: {next_step}"
        )
    else:
        next_step = None
        next_text = "Todos los pasos tienen evidencia: comprueba el objetivo una última vez y resume el resultado"

    result: JsonObject = {
        "recorded": True,
        "done": len(done_ids),
        "total": len(steps),
        "remaining": [step["title"] for step in remaining],
        "ready": ready,
        "needs_in_progress": bool(remaining) and not in_progress and not failed,
        "next_step": next_step,
        "next": next_text,
    }
    if failed:
        result["failed"] = [step["title"] for step in failed]
    if blocked:
        result["blocked"] = blocked
    return result


def update(params: JsonObject) -> JsonObject:
    goal = str(params.get("goal") or "").strip()
    raw = params.get("steps")
    if not goal or not isinstance(raw, list) or not raw:
        raise ValueError("Indica el objetivo y al menos un paso")
    if len(raw) > _MAX_STEPS:
        raise ValueError(f"El plan admite hasta {_MAX_STEPS} pasos")
    steps, by_id, by_title = _parse_steps(raw)
    resolved = _resolve_dependencies(steps, by_id, by_title)
    _reject_cycles(steps, resolved)
    return _result(steps, resolved)
