"""Nodo ``agent`` con herramientas: bucle de tool-calling dentro del run.

Cuando ``config.tools`` está activo, el modelo puede pedir herramientas
orquestables (se ejecutan en línea) y herramientas con efectos. Las con
efectos pausan el run —estado ``waiting`` con el historial persistido en el
checkpoint— hasta que el usuario decide en Ejecuciones; al aprobar/rechazar,
el run se reanuda donde quedó.
"""

from __future__ import annotations

import hashlib
import json
import ntpath
from collections.abc import Callable
from typing import Any

from backend.core.flows import agent_chat, mcp_servers
from backend.core.flows.agent_chat import gated_methods
from backend.core.flows.cancel import await_or_cancel
from backend.core.flows.expr import interpolate_text, resolve
from backend.core.flows.types import JsonObject
from backend.core.ipc_catalog import ORCHESTRATABLE_METHODS, lane_for

_MAX_TOOL_RESULT_CHARS = 4000


class AwaitingApproval(Exception):
    """Pausa el run: el agente pidió una herramienta con efectos.

    ``state`` se persiste en el checkpoint del run y la reanudación aplica la
    decisión guardada en ``checkpoint.approvals[approval_id].decision``.
    """

    def __init__(self, state: JsonObject) -> None:
        super().__init__("El nodo agente espera aprobación del usuario")
        self.state = state


def _effect_id(node_id: str, step: int, index: int, call: JsonObject) -> str:
    identity = [node_id, step, index, call.get("id"), call.get("name"), call.get("params")]
    encoded = json.dumps(identity, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _serialize_call(call: JsonObject) -> JsonObject:
    return {
        "id": str(call.get("id") or ""),
        "name": str(call.get("name") or ""),
        "params": call.get("params") if isinstance(call.get("params"), dict) else {},
        "gated": bool(call.get("gated")),
        "effect_id": str(call.get("effect_id") or ""),
    }


def _tool_result(call: JsonObject, content: str) -> JsonObject:
    return {
        "role": "tool_result",
        "tool_use_id": call["id"],
        "name": call["name"],
        "content": content,
    }


def _check_tool_params(args: Any) -> None:
    """El modelo no puede concederse rutas ni file grants (misma regla del chat)."""
    if isinstance(args, dict):
        for key, child in args.items():
            if key in ("_file_grants", "_flow_file_grants") or key.startswith("_resolved_"):
                raise ValueError("El agente no puede concederse permisos de archivos")
            _check_tool_params(child)
    elif isinstance(args, list):
        for child in args:
            _check_tool_params(child)
    elif isinstance(args, str) and ntpath.isabs(args):
        raise ValueError("La aprobación del agente no autoriza rutas; usa pasos de archivos del flujo")


def _execute_call(
    call: JsonObject,
    handler_getter: Callable[[str], Any],
    lane_submit: Callable[[str, Callable[[JsonObject], Any], JsonObject], Any] | None,
    validate_paths: Callable[[str, JsonObject], None],
) -> str:
    name = str(call.get("name") or "")
    mcp_ref = mcp_servers.parse_agent_tool(name)
    params = call.get("params")
    args = dict(params) if isinstance(params, dict) else {}
    try:
        if mcp_ref is not None:
            result = mcp_servers.call_tool(mcp_ref[0], name, args, advertised=True)
            return json.dumps(result, ensure_ascii=False, default=str)[:_MAX_TOOL_RESULT_CHARS]
        _check_tool_params(args)
        validate_paths(name, args)
        fn = handler_getter(name)
        if fn is None:
            raise ValueError(f"Método desconocido: {name}")
        result = lane_submit(name, fn, args) if lane_submit is not None and lane_for(name) != "sync" else fn(args)
        return json.dumps(result, ensure_ascii=False, default=str)[:_MAX_TOOL_RESULT_CHARS]
    except Exception as err:  # el error vuelve al modelo como resultado de la tool
        return json.dumps({"error": str(err)[:500]}, ensure_ascii=False)


def _apply_calls(
    calls: list[JsonObject],
    allowed: set[str],
    auto_approve: bool,
    execute: Callable[[JsonObject], str],
    state: JsonObject,
) -> None:
    """Encadena resultados; lanza AwaitingApproval en la primera call gated."""
    messages: list[JsonObject] = state["messages"]
    for index, call in enumerate(calls):
        serialized = _serialize_call(call)
        name = serialized["name"]
        if name not in allowed:
            content = json.dumps(
                {"error": f"Herramienta no disponible para este nodo: {name}"}, ensure_ascii=False
            )
        elif serialized["gated"] and not auto_approve:
            state["queued_calls"] = [_serialize_call(c) for c in calls[index + 1 :]]
            raise AwaitingApproval(state | {"pending_call": serialized})
        else:
            content = execute(serialized)
        messages.append(_tool_result(serialized, content))
    state["queued_calls"] = []


def run_agent_node(
    node: JsonObject,
    memory: JsonObject,
    *,
    handler_getter: Callable[[str], Any],
    token: object | None,
    lane_submit: Callable[[str, Callable[[JsonObject], Any], JsonObject], Any] | None,
    validate_paths: Callable[[str, JsonObject], None],
    is_cancelled: Callable[[], bool],
    state: JsonObject | None,
    approvals: dict[str, JsonObject],
    execute_with_effect: Callable[[JsonObject, Callable[[JsonObject], str]], str] | None = None,
) -> JsonObject:
    """Ejecuta el nodo agente; reanuda desde ``state`` cuando existe."""
    config = node["config"]
    provider = str(config.get("provider") or "").strip()
    prompt = resolve(config.get("prompt"), memory)
    if isinstance(prompt, str):
        prompt = interpolate_text(prompt, memory)
    if not provider:
        raise ValueError("El nodo agent requiere config.provider")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("El nodo agent requiere config.prompt")
    default_model = agent_chat.ai_providers.public_state(provider).get("default_model", "")
    model = str(config.get("model") or default_model or "").strip()
    if not model:
        raise ValueError("El nodo agent requiere un modelo (config.model)")
    system = resolve(config.get("system"), memory)
    if isinstance(system, str):
        system = interpolate_text(system, memory)
    system = system.strip() if isinstance(system, str) and system.strip() else None

    tools_cfg = config.get("tools")
    max_steps = int(config.get("max_steps") or 8)
    auto_approve = config.get("auto_approve") is True
    gated = set(gated_methods())
    allowed = set(ORCHESTRATABLE_METHODS) | gated
    allowed |= {t["name"] for t in agent_chat.tool_specs() if str(t.get("name") or "").startswith("mcp__")}
    if isinstance(tools_cfg, list):
        allowed &= {str(name) for name in tools_cfg}

    if state is None:
        state = {"messages": [{"role": "user", "content": prompt.strip()}], "step": 0}
    messages: list[JsonObject] = state["messages"]

    def execute(call: JsonObject) -> str:
        def run(item: JsonObject) -> str:
            return _execute_call(item, handler_getter, lane_submit, validate_paths)

        return execute_with_effect(call, run) if execute_with_effect else run(call)

    pending_call = state.get("pending_call")
    if pending_call is not None:
        if not pending_call.get("effect_id"):
            pending_call["effect_id"] = _effect_id(node["id"], int(state.get("step") or 0), 0, pending_call)
        approval_id = str(state.get("approval_id") or "")
        decision = (approvals.get(approval_id) or {}).get("decision")
        if decision is None:
            raise AwaitingApproval(state)
        if decision == "approved":
            content = execute(pending_call)
        else:
            content = json.dumps({"error": "El usuario rechazó esta acción"}, ensure_ascii=False)
        messages.append(_tool_result(pending_call, content))
        state.pop("pending_call", None)
        state.pop("approval_id", None)
        _apply_calls(list(state.pop("queued_calls", [])), allowed, auto_approve, execute, state)

    for _ in range(max_steps - int(state.get("step") or 0)):
        if is_cancelled():
            return {"json": {"text": "", "cancelled": True}}
        reply = await_or_cancel(
            lambda: agent_chat.chat(provider, model, messages, with_tools=True, system=system), token
        )
        state["step"] = int(state.get("step") or 0) + 1
        text = str(reply.get("text") or "")
        calls = [
            dict(
                call,
                gated=bool(mcp_servers.parse_agent_tool(name := str(call.get("name") or "")) or name in gated),
                effect_id=_effect_id(node["id"], state["step"], index, call),
            )
            for index, call in enumerate(reply.get("calls") or [])
        ]
        if calls:
            messages.append({"role": "assistant", "content": text, "tool_calls": calls})
            _apply_calls(calls, allowed, auto_approve, execute, state)
            continue
        if not text:
            return {"json": {"text": "", "provider": provider, "model": model, "steps": state["step"]}}
        return {"json": {"text": text, "provider": provider, "model": model, "steps": state["step"]}}
    return {"json": {"text": "Alcancé el límite de pasos de herramienta de este nodo.",
                     "provider": provider, "model": model, "steps": state["step"], "limit_reached": True}}
