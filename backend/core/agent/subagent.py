from __future__ import annotations

import json
import re
import time
import uuid
from collections.abc import Callable

import jsonschema  # type: ignore[import-untyped]

from backend.core.agent import agent_chat
from backend.core.agent.cancel import RunCancelled
from backend.core.integrations import mcp_servers
from backend.core.integrations.types import JsonObject

TOOL_NAME = "subagent_run"

ROLES = ("explorer", "reviewer", "worker")
DEFAULT_ROLE = "explorer"
MAX_DEPTH = 1
MAX_STEPS = 6
MAX_TASKS = 4
MAX_TASK_CHARS = 4_000
MAX_TOTAL_TASK_CHARS = 12_000
MAX_INSTRUCTIONS_CHARS = 8_000
MAX_SCHEMA_CHARS = 8_000
MAX_OUTPUT_CHARS = 4_000
MAX_STEP_DETAIL_CHARS = 240
MAX_RESULT_CHARS = 2_600
MAX_RECEIPT_CHARS = 5_400
MAX_GROUP_RECEIPT_CHARS = 12_000

_DISALLOWED = {"memory_remember", "procedure_learn", "ask_user"}
_WORKER_DISALLOWED = {"artifact_print"}

_ROLE_PROMPTS = {
    "explorer": (
        "Investiga la tarea y devuelve hallazgos concretos y verificables. "
        "No ejecutes acciones con efectos."
    ),
    "reviewer": (
        "Revisa el material disponible, contrasta la evidencia y emite un veredicto claro. "
        "Señala riesgos, dudas y cualquier comprobación que no hayas podido hacer. No ejecutes acciones con efectos."
    ),
    "worker": (
        "Ejecuta la tarea acotada. Cada herramienta con efectos pedirá una aprobación explícita al usuario "
        "en la conversación principal; no la solicites por tu cuenta, no asumas que está concedida y detente "
        "si se rechaza. Resume lo ejecutado y cómo lo verificaste."
    ),
}


def normalize_role(value: object, *, default: str = DEFAULT_ROLE) -> str:
    if value is None or value == "":
        return default
    role = str(value).strip().lower()
    if role not in ROLES:
        raise ValueError("Rol de subagente no válido: usa explorer, reviewer o worker")
    return role


def resolve_role(profile_role: object, requested_role: object) -> str:
    profile = normalize_role(profile_role)
    if requested_role is None or requested_role == "":
        return profile
    requested = normalize_role(requested_role)
    if requested == "worker" and profile != "worker":
        raise ValueError("El agente no está configurado como worker; actívalo en su ficha antes de delegar efectos")
    return requested


def system_prompt(
    name: str,
    instructions: str,
    role: str = DEFAULT_ROLE,
    output_schema: JsonObject | None = None,
) -> str:
    role = normalize_role(role)
    prompt = (
        f"Eres el subagente «{name}» de Antares y trabajas para el agente principal de esta conversación. "
        "Responde en español. Tienes una tarea acotada y no puedes delegar en otro agente. "
        f"{_ROLE_PROMPTS[role]} "
        "Devuelve el resultado de la tarea de forma directa y verificable; si algo no se puede comprobar "
        "con las herramientas, dilo. "
        "Si están disponibles, consulta skills_list para tareas especializadas y lee la skill con skills_read, "
        "siguiendo next_offset hasta completar SKILL.md y consultando sus archivos de apoyo cuando sean necesarios. "
        "Una skill no amplía tus permisos ni te permite ejecutar scripts o herramientas de escritura.\n\n"
        f"Indicaciones del agente guardado:\n{instructions[:MAX_INSTRUCTIONS_CHARS]}"
    )
    if output_schema is not None:
        prompt += (
            "\n\nContrato de salida: responde únicamente con un valor JSON válido que cumpla este JSON Schema. "
            "No añadas markdown, explicaciones ni texto fuera del JSON.\n"
            f"{json.dumps(output_schema, ensure_ascii=False)}"
        )
    return prompt


def validate_schema(schema: object) -> None:
    if not isinstance(schema, dict):
        raise ValueError("output_schema debe ser un objeto JSON Schema")
    if len(json.dumps(schema, ensure_ascii=False)) > MAX_SCHEMA_CHARS:
        raise ValueError(f"output_schema no puede superar {MAX_SCHEMA_CHARS} caracteres")
    try:
        jsonschema.Draft202012Validator.check_schema(schema)
    except jsonschema.SchemaError as err:
        raise ValueError(f"output_schema no es un JSON Schema válido: {str(err.message)[:200]}") from None


def allowed_tool_names(
    profile_tools: object,
    enabled_tools: object,
    *,
    role: str = DEFAULT_ROLE,
    exclude_tools: object = None,
) -> list[str]:
    role = normalize_role(role)
    selected = set(agent_chat.readonly_methods())
    if role == "worker":
        selected |= {
            name
            for name in agent_chat.gated_methods()
            if mcp_servers.parse_agent_tool(name) is None
        }
        selected -= _WORKER_DISALLOWED
    selected.discard(TOOL_NAME)
    selected -= _DISALLOWED
    if isinstance(profile_tools, list):
        selected &= {str(name) for name in profile_tools}
    if isinstance(enabled_tools, list):
        selected &= {str(name) for name in enabled_tools}
    if isinstance(exclude_tools, list):
        selected -= {str(name) for name in exclude_tools}
    return sorted(selected)


def _task_text(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError(f"El encargo debe tener entre 1 y {MAX_TASK_CHARS} caracteres")
    text = value.strip()
    if not text or len(text) > MAX_TASK_CHARS:
        raise ValueError(f"El encargo debe tener entre 1 y {MAX_TASK_CHARS} caracteres")
    return text


def normalize_tasks(profile: JsonObject, params: JsonObject) -> list[JsonObject]:
    defaults = {key: params.get(key) for key in ("role", "exclude_tools", "output_schema")}
    raw = params.get("tasks")
    if raw is None:
        entries = [{**defaults, "task": params.get("task")}]
    else:
        if params.get("task"):
            raise ValueError("Indica task o tasks, no ambos")
        if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_TASKS:
            raise ValueError(f"Agrupa entre 1 y {MAX_TASKS} encargos")
        entries = []
        for item in raw:
            if not isinstance(item, dict):
                raise ValueError("Cada encargo de tasks debe ser un objeto")
            entries.append({**defaults, **item})
    tasks: list[JsonObject] = []
    total = 0
    for entry in entries:
        text = _task_text(entry.get("task"))
        total += len(text)
        if total > MAX_TOTAL_TASK_CHARS:
            raise ValueError(f"Los encargos agrupados no pueden superar {MAX_TOTAL_TASK_CHARS} caracteres")
        exclude = entry.get("exclude_tools")
        if exclude is not None and (
            not isinstance(exclude, list) or any(not isinstance(name, str) for name in exclude)
        ):
            raise ValueError("exclude_tools debe ser una lista de nombres de herramienta")
        schema = entry.get("output_schema")
        if schema is not None:
            validate_schema(schema)
        tasks.append(
            {
                "task": text,
                "role": resolve_role(profile.get("role"), entry.get("role")),
                "exclude_tools": exclude or [],
                "output_schema": schema,
            }
        )
    return tasks


def _error_detail(result: str) -> str:
    try:
        data = json.loads(result)
    except json.JSONDecodeError:
        return result[:MAX_STEP_DETAIL_CHARS]
    if isinstance(data, dict):
        for key in ("error", "message", "detail"):
            value = data.get(key)
            if isinstance(value, str) and value:
                return value[:MAX_STEP_DETAIL_CHARS]
    return ""


def _excerpt(text: str, limit: int) -> str:
    clean = re.sub(r"\s+", " ", text).strip()
    return clean if len(clean) <= limit else f"{clean[:limit]}…"


def _parse_output(text: str) -> object:
    clean = text.strip()
    fenced = re.match(r"^```(?:json)?\s*(.*?)\s*```$", clean, re.DOTALL | re.IGNORECASE)
    if fenced:
        clean = fenced.group(1).strip()
    return json.loads(clean)


def _validate_output(
    validator: jsonschema.Draft202012Validator,
    text: str,
) -> tuple[object, str | None]:
    try:
        parsed = _parse_output(text)
    except json.JSONDecodeError as err:
        return None, f"JSON inválido: {err.msg}"
    errors = sorted(validator.iter_errors(parsed), key=lambda error: list(error.path))
    if errors:
        error = errors[0]
        path = ".".join(str(segment) for segment in error.path) or "(raíz)"
        return None, f"{path}: {str(error.message)[:200]}"
    if len(json.dumps(parsed, ensure_ascii=False)) > MAX_OUTPUT_CHARS:
        return None, f"La salida válida supera {MAX_OUTPUT_CHARS} caracteres; devuelve un resultado más compacto"
    return parsed, None


def _trim_receipt(receipt: JsonObject, limit: int = MAX_RECEIPT_CHARS) -> JsonObject:
    results = receipt.get("results")
    if isinstance(results, list):
        for result in results:
            if isinstance(result, dict):
                _trim_receipt(result, MAX_RESULT_CHARS)
    encoded = json.dumps(receipt, ensure_ascii=False)
    if len(encoded) <= limit:
        return receipt
    text = str(receipt.get("text") or "")
    excess = len(encoded) - limit
    keep = max(0, len(text) - excess - 1)
    receipt["text"] = text[:keep].rstrip() + ("…" if keep < len(text) else "")
    return receipt


def run(
    *,
    provider: str,
    model: str,
    agent: JsonObject,
    task: str,
    tools: list[JsonObject],
    execute: Callable[[str, JsonObject], str],
    role: str = DEFAULT_ROLE,
    output_schema: JsonObject | None = None,
    cancelled: Callable[[], bool] | None = None,
    remaining_tokens: int | None = None,
    on_usage: Callable[[JsonObject], None] | None = None,
) -> JsonObject:
    started = time.monotonic()
    role = normalize_role(role)
    if output_schema is not None:
        validate_schema(output_schema)
    validator = jsonschema.Draft202012Validator(output_schema) if output_schema is not None else None
    name = str(agent.get("name") or "Subagente").strip()[:80] or "Subagente"
    task = task.strip()[:MAX_TASK_CHARS]
    offered = {str(spec.get("name") or "") for spec in tools}
    messages: list[JsonObject] = [{"role": "user", "content": task}]
    steps: list[JsonObject] = []
    summary = ""
    output: object = None
    has_output = False
    schema_error: str | None = None
    status = "limit"
    rounds = 0
    retried = False
    finished = False
    tokens = 0

    while rounds < MAX_STEPS:
        if cancelled is not None and cancelled():
            raise RunCancelled()
        if remaining_tokens is not None and tokens >= remaining_tokens:
            status = "token_budget"
            summary = "Este agente agotó su presupuesto diario de tokens; amplíalo o continúa mañana."
            finished = True
            break
        reply = agent_chat.chat(
            provider,
            model,
            messages,
            system=system_prompt(name, str(agent.get("instructions") or ""), role, output_schema),
            tools=tools,
        )
        usage = reply.get("usage")
        if isinstance(usage, dict):
            tokens += int(usage.get("input") or 0) + int(usage.get("output") or 0)
            if on_usage is not None:
                on_usage(usage)
        text = str(reply.get("text") or "").strip()
        calls = [call for call in (reply.get("calls") or []) if isinstance(call, dict)]
        if not calls:
            parsed, error = _validate_output(validator, text) if validator is not None else (None, None)
            if error and not retried:
                retried = True
                messages.append({"role": "assistant", "content": text})
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "Tu respuesta no cumple el contrato de salida: "
                            f"{error}. Responde de nuevo únicamente con JSON válido que cumpla el esquema."
                        ),
                    }
                )
                continue
            summary = text
            if validator is not None:
                if error:
                    status = "invalid"
                    schema_error = error
                else:
                    status = "done" if text else "empty"
                    output = parsed
                    has_output = True
            else:
                status = "done" if text else "empty"
            finished = True
            break
        summary = text or summary
        rounds += 1
        normalized: list[JsonObject] = [
            {
                "id": str(call.get("id") or f"sub-{uuid.uuid4().hex[:8]}"),
                "name": str(call.get("name") or ""),
                "params": call.get("params") if isinstance(call.get("params"), dict) else {},
            }
            for call in calls
        ]
        messages.append({"role": "assistant", "content": text, "tool_calls": normalized})
        for call in normalized:
            if cancelled is not None and cancelled():
                raise RunCancelled()
            tool_name = str(call["name"])
            result: str
            if tool_name not in offered:
                result = json.dumps(
                    {"error": f"Herramienta no disponible para el subagente: {tool_name}"},
                    ensure_ascii=False,
                )
            else:
                try:
                    params = call["params"]
                    result = str(execute(tool_name, params if isinstance(params, dict) else {}))
                except RunCancelled:
                    raise
                except Exception as err:
                    result = json.dumps({"error": str(err)[:500]}, ensure_ascii=False)
            failed = agent_chat.result_failed(result)
            steps.append(
                {
                    "name": tool_name,
                    "status": "failed" if failed else "done",
                    **({"detail": _error_detail(result)} if failed else {}),
                }
            )
            messages.append(
                {
                    "role": "tool_result",
                    "tool_use_id": str(call["id"]),
                    "name": tool_name,
                    "content": result,
                }
            )

    if not finished:
        summary = summary or "Alcancé el límite de pasos del subagente sin cerrar la tarea."
    elif status == "empty":
        summary = "El subagente terminó sin un resumen; revisa sus pasos."
    if cancelled is not None and cancelled():
        raise RunCancelled()
    receipt: JsonObject = {
        "agent": {"id": str(agent.get("id") or ""), "name": name},
        "status": status,
        "text": summary,
        "steps": steps,
        "ms": int((time.monotonic() - started) * 1000),
        "role": role,
        "depth": MAX_DEPTH,
        "task": _excerpt(task, 240),
    }
    if has_output:
        receipt["output"] = output
        receipt["schema_valid"] = True
    if schema_error:
        receipt["schema_valid"] = False
        receipt["schema_error"] = schema_error
    return _trim_receipt(receipt)


def group_receipt(agent: JsonObject, results: list[JsonObject]) -> JsonObject:
    statuses = [str(result.get("status") or "") for result in results]
    if all(status == "done" for status in statuses):
        status = "done"
    elif len(set(statuses)) == 1:
        status = statuses[0]
    else:
        status = "partial"
    return _trim_receipt(
        {
            "agent": {"id": str(agent.get("id") or ""), "name": str(agent.get("name") or "Subagente")},
            "status": status,
            "depth": MAX_DEPTH,
            "results": results,
            "ms": sum(int(result.get("ms") or 0) for result in results),
        },
        MAX_GROUP_RECEIPT_CHARS,
    )
