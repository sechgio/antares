from __future__ import annotations

from backend.core.exceptions import NotFoundError, ValidationError
from backend.core.flows import agent as _agent
from backend.core.flows import agent_chat as _agent_chat
from backend.core.flows import ai_providers as _ai_providers
from backend.core.flows import mcp_servers as _mcp_servers
from backend.core.flows.types import JsonObject
from backend.handlers.common import validate_params, with_locale


def _store() -> _agent.AgentStore:
    return _agent.get_agent_store()


def _runner() -> _agent.AgentRunner:
    return _agent.get_agent_runner()


def _session_or_raise(session_id: str) -> JsonObject:
    session = _store().get_session(session_id)
    if session is None:
        raise NotFoundError(f"Conversación no encontrada: {session_id}")
    return session


@with_locale
def _sessions_list(params: JsonObject) -> JsonObject:
    return {"sessions": _store().list_sessions()}


@with_locale
@validate_params("provider")
def _session_create(params: JsonObject) -> JsonObject:
    provider = str(params["provider"])
    spec = _ai_providers.get_provider(provider)
    if not isinstance(spec.get("chat"), dict):
        raise ValidationError(f"El proveedor {provider} no soporta chat")
    state = _ai_providers.public_state(provider)
    if state.get("needs_key") and not state.get("has_key"):
        raise ValidationError("Configura la clave del proveedor en Proveedores IA")
    model = params.get("model")
    default_model = state.get("default_model")
    session = _store().create_session(
        provider,
        model[:120] if isinstance(model, str) and model else str(default_model or ""),
        str(params.get("title") or "")[:120],
    )
    return {"session": session}


@with_locale
@validate_params("id")
def _session_delete(params: JsonObject) -> JsonObject:
    session_id = str(params["id"])
    _runner().cancel_turn(session_id)
    if not _store().delete_session(session_id):
        raise NotFoundError(f"Conversación no encontrada: {session_id}")
    return {"deleted": True, "id": session_id}


@with_locale
@validate_params("session_id")
def _messages_list(params: JsonObject) -> JsonObject:
    session_id = str(params["session_id"])
    _session_or_raise(session_id)
    runner = _runner()
    messages = _store().messages(session_id)
    partial = runner.partial_text(session_id)
    if partial:
        messages.append({"role": "assistant", "content": partial, "partial": True})
    return {
        "messages": messages,
        "running": runner.is_running(session_id),
        "pending_approvals": _store().pending_approvals(session_id),
    }


@with_locale
@validate_params("session_id", "content")
def _message_send(params: JsonObject) -> JsonObject:
    session_id = str(params["session_id"])
    _session_or_raise(session_id)
    content = str(params["content"]).strip()[: _agent_chat.MAX_MESSAGE_CHARS]
    if not content:
        raise ValidationError("El mensaje está vacío")
    try:
        _runner().start_turn(session_id, content)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    return {"accepted": True}


@with_locale
def _tools_list(params: JsonObject) -> JsonObject:
    tools = []
    for spec in _agent_chat.tool_specs():
        name = str(spec.get("name") or "")
        tools.append(
            {
                "name": name,
                "gated": bool(spec.get("gated")),
                "kind": "mcp" if _mcp_servers.parse_agent_tool(name) is not None else "backend",
            }
        )
    return {"tools": tools}


@with_locale
@validate_params("session_id")
def _turn_status(params: JsonObject) -> JsonObject:
    session_id = str(params["session_id"])
    session = _session_or_raise(session_id)
    return {
        "running": _runner().is_running(session_id),
        "pending_approvals": _store().pending_approvals(session_id),
        "last_error": session.get("last_error"),
    }


@with_locale
@validate_params("session_id")
def _turn_cancel(params: JsonObject) -> JsonObject:
    session_id = str(params["session_id"])
    _session_or_raise(session_id)
    return {"cancelled": _runner().cancel_turn(session_id)}


@with_locale
@validate_params("approval_id")
def _approve(params: JsonObject) -> JsonObject:
    try:
        approval = _runner().decide(str(params["approval_id"]), True)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    return {"approval": approval}


@with_locale
@validate_params("approval_id")
def _deny(params: JsonObject) -> JsonObject:
    try:
        approval = _runner().decide(str(params["approval_id"]), False)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    return {"approval": approval}


HANDLERS = {
    "agent_sessions_list": _sessions_list,
    "agent_session_create": _session_create,
    "agent_session_delete": _session_delete,
    "agent_messages_list": _messages_list,
    "agent_message_send": _message_send,
    "agent_tools_list": _tools_list,
    "agent_turn_status": _turn_status,
    "agent_turn_cancel": _turn_cancel,
    "agent_approve": _approve,
    "agent_deny": _deny,
}
