"""RPC internos del agente nativo (Electron → Python), nunca del renderer.

El runtime del agente vive en el proceso principal de Electron (pi-durable +
pi-ai); estos métodos conservan en Python lo que no sale de él: vault de
proveedores, allowlist y dispatch por lanes del scheduler, validación de rutas,
servidores MCP y aprobaciones. El catálogo los marca ``internal: true``: el
router los rechaza antes de aceptar una llamada del renderer.

El dispatch se reserva de forma atómica por ``(session_id, call_id)``
(``AgentStore.dispatch_claim``): solo el ganador arranca el worker, una
repetición con la misma intención sirve el comprobante guardado, otra intención
con el mismo ``call_id`` es un conflicto y nunca se reejecuta un efecto cuyo
resultado quedó incierto (replay unsafe por defecto). Los efectos sobre el mismo
recurso se serializan.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

from backend.core.agent import agent as _agent
from backend.core.agent import agent_chat as _agent_chat
from backend.core.agent import agent_tools, artifacts, canvas_edit, documents, drafts, resource_grants
from backend.core.agent import modules as _agent_modules
from backend.core.agent.cancel import RunCancelled, _CancelEvent
from backend.core.exceptions import NotFoundError, ValidationError
from backend.core.integrations import ai_providers as _ai_providers
from backend.core.integrations import mcp_servers as _mcp_servers
from backend.core.integrations.types import JsonObject
from backend.core.ipc_catalog import input_schema_for
from backend.handlers.common import validate_params, with_locale


def _store() -> _agent.AgentStore:
    return _agent.get_agent_store()


_inflight: dict[str, _CancelEvent] = {}
_inflight_lock = threading.Lock()
_resource_locks: dict[str, threading.Lock] = {}
_NATIVE_PREFIXES = ("autoimg_", "technical_reports_export_pdf", "informes_v2_export_pdf", "fichas_tecnicas_export_pdf",
                    "document_generate", "padron_", "volantes_", "espacios_", "canvas_fill_fields")


def _resource_keys(params: JsonObject) -> list[str]:
    """Claves de recurso de un efecto: documento/registro por ``id`` y archivos de salida."""
    keys: set[str] = set()
    document = params.get("document")
    for value in (params.get("id"), document.get("id") if isinstance(document, dict) else None):
        if isinstance(value, (str, int)) and str(value):
            keys.add(f"id:{value}")
    for name in ("output_path", "outputPath", "pdf_path", "path"):
        value = params.get(name)
        if isinstance(value, str) and value:
            keys.add(f"path:{value.casefold()}")
    return sorted(keys)


def _locks_for(keys: list[str]) -> list[threading.Lock]:
    with _inflight_lock:
        return [_resource_locks.setdefault(key, threading.Lock()) for key in keys]


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


def _intent(session_id: str, method: str, params: JsonObject, context: JsonObject | None = None) -> JsonObject:
    """Intención que firma una aprobación: parámetros y revisión de cada archivo
    concedido que lee. Cambiar el archivo después de aprobar invalida la aprobación."""
    try:
        artifact_context: JsonObject = {}
        store = _store()
        resources = _agent.read_resources(method, params, store.grants_for(session_id), store.drafts_dir(session_id))
        resources = [{**record, **resource_grants.revision(str(record["path"]))} for record in resources]
        if method == "drafts_save":
            root = store.drafts_dir(session_id)
            source = drafts.inside(root, str(root / str(params.get("name") or "")))
            if source is None:
                raise ValueError("El borrador no está autorizado")
            resources.append(resource_grants.revision(str(source)))
            folder_path = str(params.get("destination_folder") or "")
            if Path(folder_path).exists():
                folder = resource_grants.folder_record(folder_path, None)
                resources.append({k: folder[k] for k in ("path", "dev", "ino")})
                target = Path(str(folder["path"])) / drafts.safe_name(params.get("filename") or source.name)
                resources.append(resource_grants.revision(str(target)) if target.exists() else {"path": str(target), "exists": False})
            else:
                resources.append({"path": folder_path, "exists": False})
        if method == "artifact_print":
            artifact, file, path = artifacts.verified_file(store, session_id, params)
            if (artifact.get("reviewed") or {}).get(str(params.get("file_index", 0))) != file["sha256"]:
                raise ValueError("Revisa el PDF en el chat antes de imprimirlo")
            resources.append(resource_grants.revision(str(path)))
            artifact_context = {"filename": file["name"], "sha256": file["sha256"]}
        tool = agent_tools.SPECS.get(method) or {"inputSchema": input_schema_for(method)}
        current_context = dict(context or {})
        current_context.update(artifact_context)
        mcp = _mcp_servers.parse_agent_tool(method)
        if mcp is not None:
            current_context = _mcp_servers.approval_context(mcp[0], method)
    except ValueError as err:
        raise ValidationError(str(err)) from err
    return {"params": json.loads(json.dumps(params)), "resources": resources,
            "tool_version": _agent.fingerprint("tool-policy-v1", tool), "context": current_context}


def _intent_fingerprint(session_id: str, method: str, params: JsonObject, context: JsonObject | None = None) -> str:
    return _agent.fingerprint(method, _intent(session_id, method, params, context))


@with_locale
@validate_params("session_id", "paths")
def _grants_add(params: JsonObject) -> JsonObject:
    """Concede lectura de los archivos que el humano escribió o adjuntó, y de las
    carpetas que eligió en el diálogo de adjuntos.

    Solo lo llama Electron con rutas del texto del usuario o de su diálogo; el
    modelo no tiene acceso a este método (``agent_`` está denegado e ``internal``)."""
    session_id = str(params["session_id"])
    paths = params["paths"]
    folders = params.get("folders") or []
    if not isinstance(paths, list) or not isinstance(folders, list):
        raise ValidationError("paths y folders deben ser listas")
    request_id = params.get("request_id")
    granted: list[str] = []
    rejected: list[JsonObject] = []
    records: list[JsonObject] = []
    items = [(raw, False) for raw in paths] + [(raw, True) for raw in folders]
    for raw, is_folder in items[: resource_grants.MAX_GRANTS_PER_MESSAGE]:
        try:
            make = resource_grants.folder_record if is_folder else resource_grants.grant_record
            record = make(str(raw), str(request_id) if request_id else None)
        except ValueError as err:
            rejected.append({"path": str(raw), "reason": str(err)})
            continue
        records.append(record)
        granted.append(str(record["path"]))
    if records:
        _store().add_grants(session_id, records)
    return {"granted": granted, "rejected": rejected}


@with_locale
@validate_params("text")
def _mentions(params: JsonObject) -> JsonObject:
    """Resuelve las ``@menciones`` del texto del humano a módulos de Antares y
    prepara el contexto que acompaña su mensaje al modelo."""
    result = _agent_modules.resolve_mentions(str(params["text"]))
    if result["modules"]:
        native = params.get("native_tools")
        names = [str(spec["name"]) for spec in _agent_chat.tool_specs()]
        names += [str(n) for n in native if isinstance(n, str)] if isinstance(native, list) else []
        result["context"] = _agent_modules.mention_context(result["modules"], names)
    return result


@with_locale
@validate_params("session_id")
def _grants_revoke(params: JsonObject) -> JsonObject:
    return {"revoked": _store().revoke_grants(str(params["session_id"]))}


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
    method = str(params["method"])
    call_params = params.get("params") or {}
    if method.startswith(_NATIVE_PREFIXES) and not (params.get("context") or {}).get("tool_version"):
        raise ValidationError("La herramienta nativa necesita su contexto actual antes de pedir aprobación")
    store = _store()
    snapshot = _intent(session_id, method, call_params, params.get("context"))
    intent = _agent.fingerprint(method, snapshot)
    approval = store.ensure_approval(
        session_id, {"id": call_id, "name": method, "params": snapshot["params"], "fingerprint": intent,
                     "context": snapshot["context"], "resources": snapshot["resources"]},
    )
    if approval.get("method") != method or approval.get("fingerprint") != intent:
        raise ValidationError("Esta llamada ya tiene una aprobación con otros parámetros o archivos")
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
    """Reserva y arranca la ejecución de una herramienta en un hilo daemon; el
    resultado se sondea con ``agent_internal_dispatch_result``. Los efectos
    ``gated`` consumen en la reserva una aprobación ``approved`` vinculada a la
    llamada y con la misma huella de parámetros."""
    session_id = str(params["session_id"])
    call_id = str(params["call_id"])
    name = str(params["name"])
    call_params = params.get("params")
    if not isinstance(call_params, dict):
        call_params = {}

    native = params.get("native") is True
    if native:
        # Herramientas que Electron ejecuta en el proceso principal: Python solo
        # reserva la operación y consume la aprobación; Electron registra el
        # resultado con agent_internal_dispatch_finish.
        if not name.startswith(_NATIVE_PREFIXES):
            return _dispatch_error(f"Herramienta no disponible para el agente: {name}")
        gated = params.get("gated") is not False
        if gated and not (params.get("context") or {}).get("tool_version"):
            return _dispatch_error("La herramienta nativa necesita revalidar la cuenta y sus permisos")
    else:
        is_mcp = _mcp_servers.parse_agent_tool(name) is not None
        gated = is_mcp or name in _agent_chat.gated_methods()
        if not gated and name not in _agent_chat.readonly_methods():
            return _dispatch_error(f"Herramienta no disponible para el agente: {name}")
    approval_id = params.get("approval_id")
    if gated and not isinstance(approval_id, str):
        return _dispatch_error("La herramienta requiere una aprobación aprobada para esta llamada")

    store = _store()
    try:
        intent = _intent(session_id, name, call_params, params.get("context"))
    except ValidationError as err:
        return _dispatch_error(str(err))
    outcome, record = store.dispatch_claim(
        session_id, call_id, name, intent, str(approval_id) if gated else None,
    )
    if outcome == "rejected":
        return _dispatch_error(str(record["error"]))
    if outcome == "conflict":
        return {**_dispatch_error("El identificador de la llamada ya se usó con otra intención en esta conversación"),
                "dispatch": record}
    if outcome == "existing":
        # Deduplicación: una repetición sirve lo persistido; un "running" sigue
        # en vuelo (o quedará "uncertain" al reabrir el store tras un crash).
        return {"result": (record.get("summary") or record.get("result")) if record.get("status") != "running" else None,
                "dispatch": record}

    op_id = str(record["op_id"])
    if native:
        return {"result": None, "dispatch": record, "execute": "native"}
    token = _CancelEvent()
    with _inflight_lock:
        _inflight[op_id] = token
    locks = _locks_for(_resource_keys(call_params)) if gated else []
    call_params = intent["params"]

    def _run() -> None:
        acquired: list[threading.Lock] = []
        try:
            for lock in locks:
                lock.acquire()
                acquired.append(lock)
            if _intent_fingerprint(session_id, name, call_params, params.get("context")) != _agent.fingerprint(name, intent):
                raise ValidationError("Los parámetros o recursos cambiaron después de reservar la operación")
            result = _agent.get_agent_runner()._execute(
                {"id": call_id, "name": name, "params": call_params, "session_id": session_id, "op_id": op_id,
                 "approved_context": intent["context"]}, token
            )
            status = "failed" if _agent.result_failed(result) else "submitted" if name == "artifact_print" else "succeeded"
        except RunCancelled:
            result = _agent._INTERRUPTED_RESULT
            status = "uncertain"
        except Exception as err:  # nunca pierdas el resultado: queda registrado
            result = json.dumps({"error": str(err)[:500]}, ensure_ascii=False)
            status = "failed"
        finally:
            for lock in reversed(acquired):
                lock.release()
        store.dispatch_finish(session_id, call_id, op_id, status, str(result))
        with _inflight_lock:
            _inflight.pop(op_id, None)

    threading.Thread(target=_run, name=f"agent-dispatch-{op_id}", daemon=True).start()
    return {"result": None, "dispatch": record}


@with_locale
@validate_params("session_id", "call_id")
def _dispatch_result(params: JsonObject) -> JsonObject:
    session_id, call_id = str(params["session_id"]), str(params["call_id"])
    record = _store().get_dispatch(session_id, call_id)
    if record is None:
        raise NotFoundError(f"Dispatch no encontrado: {call_id}")
    result = (record.get("summary") or record.get("result")) if record.get("status") != "running" else None
    return {"dispatch": {k: v for k, v in record.items() if k != "result"}, "result": result}


@with_locale
@validate_params("session_id", "call_id", "op_id", "result")
def _dispatch_finish(params: JsonObject) -> JsonObject:
    """Registra el resultado de una herramienta nativa ejecutada por Electron."""
    session_id, call_id = str(params["session_id"]), str(params["call_id"])
    result = str(params["result"])
    store = _store()
    record = store.get_dispatch(session_id, call_id)
    if record is None or record.get("op_id") != params["op_id"]:
        raise NotFoundError(f"Dispatch no encontrado: {call_id}")
    if record.get("status") in {"running", "uncertain"}:
        try:
            payload = json.loads(result)
            if isinstance(payload, dict) and not _agent.result_failed(result):
                artifact = documents.native_artifact(payload, store.drafts_dir(session_id), str(params["op_id"]))
                if artifact is not None:
                    payload["artifact"] = store.add_artifact(session_id, artifact)
                    result = json.dumps(payload, ensure_ascii=False)
        except (ValueError, OSError) as err:
            result = json.dumps({"error": str(err)}, ensure_ascii=False)
    status = "failed" if _agent.result_failed(result) else "succeeded"
    if params.get("uncertain") is True:
        status = "uncertain"
    _store().dispatch_finish(session_id, call_id, str(params["op_id"]), status, result)
    record = _store().get_dispatch(session_id, call_id)
    if record is None or record.get("op_id") != params["op_id"]:
        raise NotFoundError(f"Dispatch no encontrado: {call_id}")
    return {"result": (record.get("summary") or record.get("result")) if record.get("status") != "running" else None}


@with_locale
@validate_params("session_id", "params")
def _document_plan(params: JsonObject) -> JsonObject:
    session_id = str(params["session_id"])
    store = _store()
    plan = documents.render_plan(params["params"], store.grants_for(session_id), store.drafts_dir(session_id))
    if plan.get("artifact"):
        plan["result"]["artifact"] = store.add_artifact(session_id, plan.pop("artifact"))
    return plan


@with_locale
@validate_params("session_id")
def _artifacts(params: JsonObject) -> JsonObject:
    return {"artifacts": _store().artifacts_for(str(params["session_id"])),
            "questions": _store().questions_for(str(params["session_id"]))}


@with_locale
def _activity(params: JsonObject) -> JsonObject:
    return {"attention": _store().attention()}


@with_locale
@validate_params("session_id", "question_id", "answers")
def _question_answer(params: JsonObject) -> JsonObject:
    try:
        return {"question": _store().answer_question(str(params["session_id"]), str(params["question_id"]), params["answers"])}
    except ValueError as err:
        raise ValidationError(str(err)) from err


@with_locale
@validate_params("session_id", "artifact_id", "action")
def _artifact_action(params: JsonObject) -> JsonObject:
    try:
        return artifacts.action(_store(), str(params["session_id"]), params)
    except ValueError as err:
        raise ValidationError(str(err)) from err


@with_locale
@validate_params("session_id", "call_id", "method", "params")
def _artifact_effect(params: JsonObject) -> JsonObject:
    if params["method"] not in {"artifact_print", "drafts_save"}:
        raise ValidationError("Efecto de artefacto no permitido")
    if params["method"] == "artifact_print":
        try:
            artifacts.validate_print(_store(), str(params["session_id"]), params["params"])
        except ValueError as err:
            raise ValidationError(str(err)) from err
    return {"approval": _approval_ensure(params)["approval"]}


@with_locale
@validate_params("session_id", "call_id")
def _dispatch_cancel(params: JsonObject) -> JsonObject:
    record = _store().get_dispatch(str(params["session_id"]), str(params["call_id"]))
    with _inflight_lock:
        token = _inflight.get(str(record.get("op_id"))) if record else None
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
    "agent_internal_dispatch_finish": _dispatch_finish,
    "agent_internal_grants_add": _grants_add,
    "agent_internal_grants_revoke": _grants_revoke,
    "agent_internal_mentions": _mentions,
    "agent_internal_document_plan": _document_plan,
    "agent_canvas_fill": canvas_edit.fill_fields,
    "agent_internal_artifacts": _artifacts,
    "agent_internal_artifact_action": _artifact_action,
    "agent_internal_artifact_effect": _artifact_effect,
    "agent_internal_activity": _activity,
    "agent_question_answer": _question_answer,
}
