from __future__ import annotations

import json
import time
import uuid
from collections.abc import Callable

from backend.core.agent import agent_chat
from backend.core.agent.cancel import RunCancelled
from backend.core.integrations.types import JsonObject

TOOL_NAME = "subagent_run"

MAX_STEPS = 6
MAX_TASK_CHARS = 4_000
MAX_INSTRUCTIONS_CHARS = 8_000
MAX_STEP_DETAIL_CHARS = 240
MAX_RECEIPT_CHARS = 5_400

_DISALLOWED = {"memory_remember", "procedure_learn"}


def system_prompt(name: str, instructions: str) -> str:
    return (
        f"Eres el subagente «{name}» de Antares y trabajas para el agente principal de esta conversación. "
        "Responde en español. Tienes una tarea acotada y solo herramientas de lectura: no puedes modificar "
        "datos, pedir aprobaciones ni delegar en otro agente. Devuelve el resultado de la tarea de forma "
        "directa y verificable; si algo no se puede comprobar con las herramientas, dilo.\n\n"
        f"Indicaciones del agente guardado:\n{instructions[:MAX_INSTRUCTIONS_CHARS]}"
    )


def allowed_tool_names(
    profile_tools: object,
    enabled_tools: object,
) -> list[str]:
    readable = set(agent_chat.readonly_methods())
    readable.discard(TOOL_NAME)
    readable -= _DISALLOWED
    selected = readable
    if isinstance(profile_tools, list):
        selected = selected & {str(name) for name in profile_tools}
    if isinstance(enabled_tools, list):
        selected = selected & {str(name) for name in enabled_tools}
    return sorted(selected)


def _result_failed(result: str) -> bool:
    try:
        data = json.loads(result)
    except json.JSONDecodeError:
        return False
    return isinstance(data, dict) and ("error" in data or data.get("isError") is True)


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


def _trim_receipt(receipt: JsonObject) -> JsonObject:
    encoded = json.dumps(receipt, ensure_ascii=False)
    if len(encoded) <= MAX_RECEIPT_CHARS:
        return receipt
    text = str(receipt.get("text") or "")
    excess = len(encoded) - MAX_RECEIPT_CHARS
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
    cancelled: Callable[[], bool] | None = None,
) -> JsonObject:
    started = time.monotonic()
    name = str(agent.get("name") or "Subagente").strip()[:80] or "Subagente"
    task = task.strip()[:MAX_TASK_CHARS]
    readable = {str(spec.get("name") or "") for spec in tools}
    messages: list[JsonObject] = [{"role": "user", "content": task}]
    steps: list[JsonObject] = []
    summary = ""
    status = "limit"

    for _ in range(MAX_STEPS):
        if cancelled is not None and cancelled():
            raise RunCancelled()
        reply = agent_chat.chat(
            provider,
            model,
            messages,
            system=system_prompt(name, str(agent.get("instructions") or "")),
            tools=tools,
        )
        text = str(reply.get("text") or "").strip()
        calls = [call for call in (reply.get("calls") or []) if isinstance(call, dict)]
        if not calls:
            summary = text
            status = "done" if text else "empty"
            break
        summary = text or summary
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
            if tool_name not in readable:
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
            failed = _result_failed(result)
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

    if status == "limit":
        summary = summary or "Alcancé el límite de pasos del subagente sin cerrar la tarea."
    elif status == "empty":
        summary = "El subagente terminó sin un resumen; revisa sus pasos."
    return _trim_receipt(
        {
            "agent": {"id": str(agent.get("id") or ""), "name": name},
            "status": status,
            "text": summary,
            "steps": steps,
            "ms": int((time.monotonic() - started) * 1000),
        }
    )
