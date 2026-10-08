"""RPC internos del agente nativo (Electron → Python), nunca del renderer.

El runtime del agente vive en el proceso principal de Electron (pi-durable +
pi-ai); estos métodos conservan en Python lo que no sale de él: vault de
proveedores, allowlist y dispatch por lanes del scheduler, validación de rutas,
servidores MCP y aprobaciones. El catálogo los marca ``internal: true``: el
router los rechaza antes de aceptar una llamada del renderer.

El dispatch se deduplica por ``call_id`` (``AgentStore.dispatches``): una
repetición sirve el resultado guardado y nunca reejecuta un efecto cuyo
resultado quedó incierto (replay unsafe por defecto).
"""

from __future__ import annotations

import json
import threading

from backend.core.exceptions import NotFoundError, ValidationError
from backend.core.flows import agent as _agent
from backend.core.flows import agent_chat as _agent_chat
from backend.core.flows import ai_providers as _ai_providers
from backend.core.flows import mcp_servers as _mcp_servers
from backend.core.flows.cancel import RunCancelled
from backend.core.flows.runner import _CancelEvent
from backend.core.flows.types import JsonObject
from backend.core.ipc_catalog import ORCHESTRATABLE_METHODS
from backend.handlers.common import validate_params, with_locale


def _store() -> _agent.AgentStore:
    return _agent.get_agent_store()


_inflight: dict[str, _CancelEvent] = {}
_inflight_lock = threading.Lock()


@with_locale
def _tools(params: JsonObject) -> JsonObject:
    tools = []
    for spec in _agent_chat.tool_specs():
        name = str(spec.get("name") or "")
        tools.append(
            {
                **spec,
                "kind": "mcp" if _mcp_servers.parse_agent_tool(name) is not None else "backend",
            }
        )
    return {"tools": tools}


@with_locale
@validate_params("provider")
def _provider(params: JsonObject) -> JsonObject:
    """Resuelve endpoint y credencial del proveedor para el proceso principal.

    La clave viaja solo por el canal interno Electron↔Python; jamás al
    renderer ni al modelo."""
    provider = str(params["provider"])
    try:
        spec = _ai_providers.get_provider(provider)
    except ValueError as err:
        raise ValidationError(str(err)) from err
    chat_spec = spec.get("chat")
    if not isinstance(chat_spec, dict) or not chat_spec.get("style"):
        raise ValidationError(f"El proveedor {provider} no soporta chat")
    config = _ai_providers.get_config(provider) or {}
    auth = spec.get("auth") or {}
    api_key = config.get("api_key")
    if auth.get("type") == "api_key" and not (isinstance(api_key, str) and api_key):
        raise ValidationError("Configura la clave del proveedor en Proveedores IA")
    base = config.get("base_url") or spec.get("base_url")
    # pi-ai usa los SDK oficiales: añaden "/chat/completions" (openai) o
    # "/v1/messages" (anthropic) al baseUrl. El wire base es el endpoint del
    # catálogo menos ese sufijo (p. ej. Ollama sirve "/v1/chat/completions").
    style = str(chat_spec.get("style") or "")
    endpoint = ""
    if isinstance(base, str) and base:
        endpoint = _ai_providers.endpoint_url(base, str(chat_spec.get("path") or ""))
    suffix = "/v1/messages" if style == "anthropic_messages" else "/chat/completions"
    wire_base = endpoint[: -len(suffix)] if endpoint.endswith(suffix) else endpoint
    return {
        "provider": provider,
        "style": chat_spec.get("style"),
        "base_url": wire_base,
        "api_key": api_key if isinstance(api_key, str) and api_key else None,
        "auth_type": str(auth.get("type") or "none"),
        "extra_headers": {
            str(k): str(v) for k, v in (auth.get("extra_headers") or {}).items()
        },
        "default_model": config.get("model") or chat_spec.get("default_model", ""),
    }


def _approval_error(approval: JsonObject | None) -> ValidationError:
    if approval is not None and approval.get("status") == "expired":
        return ValidationError("La aprobación expiró; vuelve a pedírselo al agente")
    return ValidationError("Aprobación inexistente o ya decidida")


@with_locale
@validate_params("session_id", "call_id", "method")
def _approval_ensure(params: JsonObject) -> JsonObject:
    """Idempotente por (session_id, call_id): tras un reinicio se reanuda la
    espera sobre la misma aprobación en lugar de crear un duplicado."""
    session_id = str(params["session_id"])
    call_id = str(params["call_id"])
    store = _store()
    approval = store.approval_for_call(session_id, call_id)
    if approval is None:
        approval = store.create_approval(
            session_id,
            {"id": call_id, "name": str(params["method"]), "params": params.get("params") or {}},
        )
    return {"approval": approval}


@with_locale
@validate_params("approval_id")
def _approval_status(params: JsonObject) -> JsonObject:
    return {"approval": _store().get_approval(str(params["approval_id"]))}


@with_locale
@validate_params("approval_id", "approve")
def _approval_decide(params: JsonObject) -> JsonObject:
    approval_id = str(params["approval_id"])
    approval = _store().decide_approval(approval_id, bool(params["approve"]))
    if approval is None:
        raise _approval_error(_store().get_approval(approval_id))
    return {"approval": approval}


@with_locale
@validate_params("session_id")
def _approvals_pending(params: JsonObject) -> JsonObject:
    return {"approvals": _store().pending_approvals(str(params["session_id"]))}


@with_locale
@validate_params("session_id")
def _approvals_deny_session(params: JsonObject) -> JsonObject:
    return {"denied": _store().deny_pending_approvals(str(params["session_id"]))}


def _dispatch_error(message: str) -> JsonObject:
    return {"result": json.dumps({"error": message}, ensure_ascii=False)}


@with_locale
@validate_params("session_id", "call_id", "name")
def _dispatch(params: JsonObject) -> JsonObject:
    """Arranca la ejecución de una herramienta en un hilo daemon; el resultado
    se sondea con ``agent_internal_dispatch_result``. Los efectos ``gated``
    exigen una aprobación ``approved`` vinculada al ``call_id``."""
    session_id = str(params["session_id"])
    call_id = str(params["call_id"])
    name = str(params["name"])
    call_params = params.get("params")
    if not isinstance(call_params, dict):
        call_params = {}

    store = _store()
    existing = store.get_dispatch(call_id)
    if existing is not None:
        # Deduplicación: una repetición sirve lo persistido; un "running" sigue
        # en vuelo (o quedará "interrupted" al reabrir el store tras un crash).
        return {
            "result": existing.get("result") if existing.get("status") != "running" else None,
            "dispatch": existing,
        }

    is_mcp = _mcp_servers.parse_agent_tool(name) is not None
    gated = is_mcp or name in _agent_chat.gated_methods()
    if not gated and name not in ORCHESTRATABLE_METHODS:
        return _dispatch_error(f"Herramienta no disponible para el agente: {name}")
    if gated:
        approval_id = params.get("approval_id")
        approval = store.get_approval(str(approval_id)) if isinstance(approval_id, str) else None
        bound = (
            approval is not None
            and approval.get("status") == "approved"
            and approval.get("call_id") == call_id
            and approval.get("session_id") == session_id
            and approval.get("method") == name
        )
        if not bound:
            return _dispatch_error("La herramienta requiere una aprobación aprobada para esta llamada")

    record = store.dispatch_begin(call_id, session_id, name)
    if record.get("status") != "running" or record.get("result") is not None:
        return {"result": record.get("result") or _agent._INTERRUPTED_RESULT, "dispatch": record}

    token = _CancelEvent()
    with _inflight_lock:
        _inflight[call_id] = token

    def _run() -> None:
        try:
            result = _agent.get_agent_runner()._execute(
                {"id": call_id, "name": name, "params": call_params}, token
            )
            status = "done"
        except RunCancelled:
            result = _agent._INTERRUPTED_RESULT
            status = "interrupted"
        except Exception as err:  # nunca pierdas el resultado: queda registrado
            result = json.dumps({"error": str(err)[:500]}, ensure_ascii=False)
            status = "done"
        store.dispatch_finish(call_id, status, str(result))
        with _inflight_lock:
            _inflight.pop(call_id, None)

    threading.Thread(target=_run, name=f"agent-dispatch-{call_id}", daemon=True).start()
    return {"result": None, "dispatch": record}


@with_locale
@validate_params("call_id")
def _dispatch_result(params: JsonObject) -> JsonObject:
    call_id = str(params["call_id"])
    record = _store().get_dispatch(call_id)
    if record is None:
        raise NotFoundError(f"Dispatch no encontrado: {call_id}")
    return {"dispatch": record, "result": record.get("result")}


@with_locale
@validate_params("call_id")
def _dispatch_cancel(params: JsonObject) -> JsonObject:
    call_id = str(params["call_id"])
    with _inflight_lock:
        token = _inflight.get(call_id)
    if token is None:
        return {"cancelled": False}
    token.cancel()
    return {"cancelled": True}


HANDLERS = {
    "agent_internal_tools": _tools,
    "agent_internal_provider": _provider,
    "agent_internal_approval_ensure": _approval_ensure,
    "agent_internal_approval_status": _approval_status,
    "agent_internal_approval_decide": _approval_decide,
    "agent_internal_approvals_pending": _approvals_pending,
    "agent_internal_approvals_deny_session": _approvals_deny_session,
    "agent_internal_dispatch": _dispatch,
    "agent_internal_dispatch_result": _dispatch_result,
    "agent_internal_dispatch_cancel": _dispatch_cancel,
}
