from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path

from backend.core.agent import agent as _agent
from backend.core.agent import agent_chat as _agent_chat
from backend.core.agent import (
    agent_tools,
    approval_guard,
    artifacts,
    canvas_edit,
    computer_files,
    computer_jobs,
    documents,
    drafts,
    file_preview,
    resource_grants,
    skills,
)
from backend.core.agent import memory as _memory_store
from backend.core.agent import modules as _agent_modules
from backend.core.agent import subagent as _subagent
from backend.core.agent.cancel import RunCancelled, _CancelEvent
from backend.core.computer_use import driver as _computer_driver
from backend.core.exceptions import NotFoundError, ValidationError
from backend.core.integrations import ai_providers as _ai_providers
from backend.core.integrations import mcp_servers as _mcp_servers
from backend.core.integrations.types import JsonObject
from backend.core.ipc_catalog import input_schema_for
from backend.handlers.common import validate_params, with_locale

logger = logging.getLogger(__name__)


def _store() -> _agent.AgentStore:
    return _agent.get_agent_store()


def _memory() -> _memory_store.MemoryStore:
    return _memory_store.memory_for(_store())


def _record_outcome(session_id: str, name: str, status: str) -> None:
    try:
        _memory().record_outcome(session_id, name, status)
    except Exception:
        logger.warning("No se pudo registrar el resultado del efecto %s", name, exc_info=True)


_inflight: dict[str, _CancelEvent] = {}
_inflight_lock = threading.Lock()
_resource_locks: dict[str, threading.Lock] = {}
_native_leases: dict[str, list[threading.Lock]] = {}
_NATIVE_PREFIXES = ("autoimg_", "technical_reports_export_pdf", "informes_v2_export_pdf", "fichas_tecnicas_export_pdf",
                    "document_generate", "padron_", "volantes_", "espacios_", "canvas_fill_fields", "canvas_apply_layers",
                    "gdrive_", "gsheets_", "onedrive_", "excel_", "web_", "cua_")
_APP_SCOPED_PREFIXES = ("cua_",)
_CLOUD_UPLOADS = frozenset({"gdrive_upload", "onedrive_upload"})
_META_METHODS = frozenset({"task_schedule"})
# Métodos que el guard PUEDE auto-aprobar cuando el comando es lectura pura.
# Deliberadamente vacío: la política vigente exige que los comandos de shell los
# decida siempre el humano. El guard solo etiqueta el riesgo. Ampliar este
# conjunto es una decisión de política explícita, no un efecto de la heurística.
_GUARD_AUTOAPPROVE_METHODS: frozenset[str] = frozenset()


def _resource_keys(params: JsonObject) -> list[str]:
    keys: set[str] = set()
    document = params.get("document")
    remote = [params.get(name) for name in ("file_id", "replace_file_id", "spreadsheet_id", "item_id", "replace_item_id")]
    for value in (params.get("id"), document.get("id") if isinstance(document, dict) else None, *remote):
        if isinstance(value, (str, int)) and str(value):
            keys.add(f"id:{value}")
    for name in ("output_path", "outputPath", "pdf_path", "path"):
        value = params.get(name)
        if isinstance(value, str) and value:
            keys.add(f"path:{value.casefold()}")
    return sorted(keys)


def _resource_lock_keys(params: JsonObject, resources: object) -> list[str]:
    keys = set(_resource_keys(params))
    if isinstance(resources, list):
        for resource in resources:
            path = resource.get("path") if isinstance(resource, dict) else None
            if isinstance(path, str) and path:
                keys.add(f"path:{path.casefold()}")
    return sorted(keys)


def _locks_for(keys: list[str]) -> list[threading.Lock]:
    with _inflight_lock:
        return [_resource_locks.setdefault(key, threading.Lock()) for key in keys]


def _context_keys(context: object) -> list[str]:
    if not isinstance(context, dict):
        return []
    for field, prefix in (("sheet_id", "sheet"), ("account_id", "account")):
        value = context.get(field)
        if isinstance(value, str) and value:
            return [f"{prefix}:{value}"]
    return []


def _try_locks(keys: list[str]) -> list[threading.Lock] | None:
    acquired: list[threading.Lock] = []
    for lock in _locks_for(keys):
        if not lock.acquire(blocking=False):
            _release(acquired)
            return None
        acquired.append(lock)
    return acquired


def _release(locks: list[threading.Lock]) -> None:
    for lock in reversed(locks):
        lock.release()


@with_locale
def _tools(params: JsonObject) -> JsonObject:
    tools = []
    for spec in _agent_chat.tool_specs():
        name = str(spec.get("name") or "")
        tools.append(
            {
                **spec,
                "kind": "mcp" if _mcp_servers.parse_agent_tool(name) is not None else "backend",
                "replay_safe": _agent_chat.replay_safe(name),
            }
        )
    return {"tools": tools}


@with_locale
@validate_params("provider")
def _provider(params: JsonObject) -> JsonObject:
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
        "custom": bool(spec.get("custom")),
        "capabilities": spec.get("capabilities") or {},
    }


@with_locale
@validate_params("profile_id", "day")
def _profile_usage(params: JsonObject) -> JsonObject:
    return {"tokens": _store().profile_usage(str(params["profile_id"]), str(params["day"]))}


def _intent(session_id: str, method: str, params: JsonObject, context: JsonObject | None = None) -> JsonObject:
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
        if method in computer_files.WRITE_TOOLS:
            resources.extend(computer_files.resources(params, store.grants_for(session_id), store.workspace_dir(session_id)))
        if method in {"shell_run", "shell_job_start"}:
            workspace = store.workspace_dir(session_id)
            cwd = computer_files.resolve(params.get("cwd") or str(workspace), store.grants_for(session_id), workspace)
            folder = resource_grants.folder_record(str(cwd), None)
            artifact_context["shell"] = {"workspace": str(workspace), "cwd": str(cwd),
                                         "dev": folder["dev"], "ino": folder["ino"]}
            params = {**params, "cwd": str(cwd)}
        if method in _CLOUD_UPLOADS:
            root = store.drafts_dir(session_id)
            source = drafts.inside(root, str(root / str(params.get("draft") or "")))
            if source is None or not source.is_file():
                raise ValueError("El borrador que se quiere subir no existe en esta conversación")
            resources.append(resource_grants.revision(str(source)))
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
    result: JsonObject = {"granted": granted, "rejected": rejected}
    folders_granted = [str(record["path"]) for record in records if record.get("mode") == "folder"]
    if folders_granted:
        result["workspace"] = _store().set_workspace(session_id, folders_granted[-1])
    return result


@with_locale
@validate_params("session_id")
def _workspace_set(params: JsonObject) -> JsonObject:
    path = params.get("path")
    try:
        return {"workspace": _store().set_workspace(str(params["session_id"]), path if isinstance(path, str) and path else None)}
    except ValueError as err:
        raise ValidationError(str(err)) from err


@with_locale
@validate_params("session_id", "path")
def _path_status(params: JsonObject) -> JsonObject:
    store = _store()
    session_id = str(params["session_id"])
    try:
        return computer_files.stat_path(params["path"], store.grants_for(session_id), store.workspace_dir(session_id))
    except ValueError as err:
        raise ValidationError(str(err)) from err


@with_locale
@validate_params("session_id")
def _file_preview(params: JsonObject) -> JsonObject:
    store = _store()
    session_id = str(params["session_id"])
    try:
        if params.get("selected_file"):
            # Solo el puente nativo proporciona un adjunto seleccionado pendiente.
            target = Path(str(resource_grants.grant_record(params["selected_file"], None)["path"]))
        else:
            value = params.get("resource")
            draft = drafts.inside(store.drafts_dir(session_id), value) if isinstance(value, str) else None
            target = computer_files.resolve(value, store.grants_for(session_id),
                                            store.drafts_dir(session_id) if draft else store.workspace_dir(session_id))
        return file_preview.render_file(target, params)
    except (ValueError, OSError) as err:
        raise ValidationError(str(err)) from err


@with_locale
@validate_params("session_id", "job_id")
def _shell_job_status(params: JsonObject) -> JsonObject:
    store = _store()
    session_id = str(params["session_id"])
    try:
        return computer_jobs.status({"job_id": params["job_id"]}, store.drafts_dir(session_id), session_id)
    except ValueError as err:
        raise ValidationError(str(err)) from err


@with_locale
@validate_params("session_id")
def _shell_jobs_cancel_session(params: JsonObject) -> JsonObject:
    return {"cancelled": computer_jobs.cancel_session(str(params["session_id"]))}


@with_locale
@validate_params("text")
def _mentions(params: JsonObject) -> JsonObject:
    result = _agent_modules.resolve_mentions(str(params["text"]))
    result["labels"] = {module: _agent_modules.label_for(module) for module in result["modules"]}
    servers = _mcp_servers.mentioned_servers(result["unknown"]) if result["unknown"] else []
    mentioned = {server["mention"] for server in servers}
    result["unknown"] = [token for token in result["unknown"] if token not in mentioned]
    result["mcp_tools"] = [name for server in servers for name in server["tools"]]
    context = []
    if result["modules"]:
        native = params.get("native_tools")
        names = [str(spec["name"]) for spec in _agent_chat.tool_specs()]
        names += [str(n) for n in native if isinstance(n, str)] if isinstance(native, list) else []
        context.append(_agent_modules.mention_context(result["modules"], names))
    if servers:
        context.append("El usuario mencionó estos servidores MCP; sus herramientas piden aprobación antes de cada llamada:\n"
                       + "\n".join(f"- {server['name']}: " + (f"no disponible, {server['error']}" if server["error"]
                                   else f"herramientas {', '.join(server['tools']) or '(ninguna habilitada)'}")
                                   for server in servers))
    if context:
        result["context"] = "\n\n".join(context)
    return result


@with_locale
@validate_params("session_id")
def _grants_revoke(params: JsonObject) -> JsonObject:
    path = params.get("path")
    if isinstance(path, str) and path:
        return {"revoked": _store().revoke_grant(str(params["session_id"]), path)}
    return {"revoked": _store().revoke_grants(str(params["session_id"]))}


@with_locale
@validate_params("session_id", "path")
def _grants_check(params: JsonObject) -> JsonObject:
    try:
        info = resource_grants.check(str(params["path"]), _store().grants_for(str(params["session_id"])))
    except ValueError as err:
        raise ValidationError(str(err)) from err
    return {"granted": True, **info}


@with_locale
@validate_params("session_id")
def _grants_list(params: JsonObject) -> JsonObject:
    grants = sorted(_store().grants_for(str(params["session_id"])).values(), key=lambda record: str(record.get("path") or ""))
    return {"grants": [
        {key: record.get(key) for key in ("path", "mode", "request_id", "size", "mtime_ns") if record.get(key) is not None}
        for record in grants
    ]}


def _approval_error(approval: JsonObject | None) -> ValidationError:
    if approval is not None and approval.get("status") == "expired":
        return ValidationError("La aprobación expiró; vuelve a pedírselo al agente")
    return ValidationError("Aprobación inexistente o ya decidida")


@with_locale
@validate_params("session_id", "call_id", "method")
def _approval_ensure(params: JsonObject) -> JsonObject:
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
                     "channel": str(params.get("channel") or "")[:24] or None,
                     "context": snapshot["context"], "resources": snapshot["resources"]},
    )
    if approval.get("method") != method or approval.get("fingerprint") != intent:
        raise ValidationError("Esta llamada ya tiene una aprobación con otros parámetros o archivos")
    unattended_apps = params.get("unattended_apps")
    if method.startswith(_APP_SCOPED_PREFIXES) and approval.get("status") == "pending":
        app = str(((approval.get("context") or {}).get("computer") or {}).get("app") or "")
        if isinstance(unattended_apps, list) and unattended_apps:
            allowed = {os.path.normcase(_computer_driver.normalize_app(str(raw))) for raw in unattended_apps}
            if app and os.path.normcase(_computer_driver.normalize_app(app)) in allowed:
                approval = store.decide_approval(str(approval["id"]), True) or approval
            else:
                raise ValidationError("Esta aplicación no está en la lista blanca del encargo programado")
        elif app and f"app:{os.path.normcase(app)}" in store.grants_for(session_id):
            approval = store.decide_approval(str(approval["id"]), True) or approval
    if approval.get("status") == "pending":
        approval = _guard_decision(store, approval, method, snapshot["params"]) or approval
    return {"approval": approval}


def _guard_decision(
    store: _agent.AgentStore, approval: JsonObject, method: str, params: JsonObject
) -> JsonObject | None:
    """Anota el riesgo del comando y auto-aprueba solo si la política lo permite.

    La clasificación se anota SIEMPRE, para dejar rastro observable. La
    auto-aprobación respeta la garantía existente de que los comandos de shell no
    se conceden solos: solo se auto-aprueba un método declarado apto.
    """
    command = approval_guard.command_of(method, params)
    if command is None:
        return None
    verdict = approval_guard.classify(command)
    store.note_approval_risk(str(approval["id"]), str(verdict["risk"]), str(verdict["reason"]))
    if verdict["decision"] != "approve":
        return None
    if method not in _GUARD_AUTOAPPROVE_METHODS:
        return None
    return store.decide_approval(str(approval["id"]), True, "smart")


@with_locale
@validate_params("approval_id")
def _approval_status(params: JsonObject) -> JsonObject:
    return {"approval": _store().get_approval(str(params["approval_id"]))}


@with_locale
@validate_params("approval_id", "approve")
def _approval_decide(params: JsonObject) -> JsonObject:
    approval_id = str(params["approval_id"])
    source = str(params.get("source") or "manual")[:16]
    approval = _store().decide_approval(approval_id, bool(params["approve"]), source)
    if approval is None:
        raise _approval_error(_store().get_approval(approval_id))
    if (params.get("grant_app") is True or params.get("remember") is True) and approval.get("status") == "approved" \
            and str(approval.get("method") or "").startswith(_APP_SCOPED_PREFIXES):
        app = str(((approval.get("context") or {}).get("computer") or {}).get("app") or "")
        if app:
            _store().add_grants(str(approval["session_id"]), [
                {"kind": "computer_app", "app": app, "key": f"app:{os.path.normcase(app)}"},
            ])
    return {"approval": approval}


@with_locale
@validate_params("session_id")
def _approvals_pending(params: JsonObject) -> JsonObject:
    return {"approvals": _store().pending_approvals(str(params["session_id"]))}


@with_locale
def _approvals_history(params: JsonObject) -> JsonObject:
    status = params.get("status")
    if status is not None and status not in {"all", "pending", "approved", "denied", "expired", "uncertain"}:
        raise ValidationError("Estado de aprobación no válido")
    method = params.get("method")
    session_id = params.get("session_id")
    limit = params.get("limit", 500)
    if not isinstance(limit, int) or isinstance(limit, bool):
        raise ValidationError("El límite del historial no es válido")
    return {"approvals": _store().approval_history(
        session_id=str(session_id) if isinstance(session_id, str) and session_id else None,
        method=str(method) if isinstance(method, str) and method else None,
        status=str(status) if isinstance(status, str) and status != "all" else None,
        limit=limit,
    )}


@with_locale
@validate_params("session_id")
def _approvals_deny_session(params: JsonObject) -> JsonObject:
    return {"denied": _store().deny_pending_approvals(str(params["session_id"]))}


def _dispatch_error(message: str) -> JsonObject:
    return {"result": json.dumps({"error": message}, ensure_ascii=False)}


@with_locale
@validate_params("session_id", "call_id", "name")
def _dispatch(params: JsonObject) -> JsonObject:
    session_id = str(params["session_id"])
    call_id = str(params["call_id"])
    name = str(params["name"])
    call_params = params.get("params")
    if not isinstance(call_params, dict):
        call_params = {}

    native = params.get("native") is True
    meta = params.get("meta") is True
    if meta:
        if name not in _META_METHODS:
            return _dispatch_error(f"Herramienta no disponible para el agente: {name}")
        gated = params.get("gated") is not False
    elif native:
        if not name.startswith(_NATIVE_PREFIXES):
            return _dispatch_error(f"Herramienta no disponible para el agente: {name}")
        gated = params.get("gated") is not False
        if gated and not (params.get("context") or {}).get("tool_version"):
            return _dispatch_error("La herramienta nativa necesita revalidar la cuenta y sus permisos")
    else:
        is_mcp = _mcp_servers.parse_agent_tool(name) is not None
        gated = is_mcp or name in _agent_chat.gated_methods()
        if not gated and name not in _agent_chat.readonly_methods() and name != _subagent.TOOL_NAME:
            return _dispatch_error(f"Herramienta no disponible para el agente: {name}")
    subagent_profile: JsonObject | None = None
    if name == _subagent.TOOL_NAME:
        context = params.get("context")
        candidate = context.get("subagent") if isinstance(context, dict) else None
        if not isinstance(candidate, dict) or not str(candidate.get("name") or "").strip():
            return _dispatch_error("El agente indicado no está disponible para delegar")
        subagent_profile = candidate
    approval_id = params.get("approval_id")
    if gated and not isinstance(approval_id, str):
        return _dispatch_error("La herramienta requiere una aprobación aprobada para esta llamada")

    channel = str(params.get("channel") or "")[:24] or None
    store = _store()
    leased: list[threading.Lock] = []
    if native and gated and store.get_dispatch(session_id, call_id) is None:
        held = _try_locks(_resource_keys(call_params) + _context_keys(params.get("context")))
        if held is None:
            return {"result": None, "busy": True}
        leased = held
    try:
        intent = _intent(session_id, name, call_params, params.get("context"))
        outcome, record = store.dispatch_claim(
            session_id, call_id, name, intent, str(approval_id) if gated else None, channel=channel,
        )
    except ValidationError as err:
        _release(leased)
        return _dispatch_error(str(err))
    except Exception:
        _release(leased)
        raise
    if outcome == "new" and native:
        with _inflight_lock:
            _native_leases[str(record["op_id"])] = leased
    else:
        _release(leased)
    if outcome == "rejected":
        return _dispatch_error(str(record["error"]))
    if outcome == "conflict":
        return {**_dispatch_error("El identificador de la llamada ya se usó con otra intención en esta conversación"),
                "dispatch": record}
    if outcome == "existing":
        return {"result": (record.get("summary") or record.get("result")) if record.get("status") != "running" else None,
                "dispatch": record}

    op_id = str(record["op_id"])
    if meta:
        return {"result": None, "dispatch": record, "execute": "meta"}
    if native:
        return {"result": None, "dispatch": record, "execute": "native"}
    token = _CancelEvent()
    with _inflight_lock:
        _inflight[op_id] = token
    locks = _locks_for(_resource_lock_keys(call_params, intent.get("resources"))) if gated else []
    call_params = intent["params"]

    def _run() -> None:
        acquired: list[threading.Lock] = []
        try:
            for lock in locks:
                lock.acquire()
                acquired.append(lock)
            if _intent_fingerprint(session_id, name, call_params, params.get("context")) != _agent.fingerprint(name, intent):
                raise ValidationError("Los parámetros o recursos cambiaron después de reservar la operación")
            resources = intent.get("resources")
            try:
                store.undo_prepare(session_id, call_id, op_id, name, resources if isinstance(resources, list) else [])
            except Exception:
                logger.warning("No se pudo preparar el Undo de %s", name, exc_info=True)
            try:
                result = _agent.get_agent_runner()._execute(
                    {"id": call_id, "name": name, "params": call_params, "session_id": session_id, "op_id": op_id,
                     "approved_context": intent["context"], "profile_id": intent["context"].get("profile_id"),
                     "profile_skills": intent["context"].get("profile_skills"),
                     **({"subagent": subagent_profile} if subagent_profile else {})},
                    token,
                )
                status = "failed" if _agent.result_failed(result) else "submitted" if name == "artifact_print" else "succeeded"
                if status == "succeeded":
                    try:
                        payload = json.loads(result)
                        artifact = payload.get("artifact") if isinstance(payload, dict) else None
                        artifact_id = artifact.get("id") if isinstance(artifact, dict) else None
                        if isinstance(artifact_id, str) and artifact_id:
                            store.dispatch_note(session_id, op_id, {"artifact_id": artifact_id})
                    except (ValueError, TypeError):
                        pass
            finally:
                try:
                    store.undo_finish(session_id, call_id, op_id)
                except Exception:
                    logger.warning("No se pudo cerrar el Undo de %s", name, exc_info=True)
        except RunCancelled:
            result = _agent._INTERRUPTED_RESULT
            status = "uncertain"
        except Exception as err:
            result = json.dumps({"error": str(err)[:500]}, ensure_ascii=False)
            status = "failed"
        finally:
            for lock in reversed(acquired):
                lock.release()
        store.dispatch_finish(session_id, call_id, op_id, status, str(result))
        _record_outcome(session_id, name, status)
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
    response: JsonObject = {"dispatch": {k: v for k, v in record.items() if k != "result"}, "result": result}
    with _inflight_lock:
        token = _inflight.get(str(record.get("op_id")))
    if result is None and token is not None and token.progress:
        response["output"] = token.progress
    return response


def _undo_summary(record: JsonObject) -> JsonObject | None:
    raw = record.get("undo")
    if not isinstance(raw, dict):
        return None
    return {key: raw[key] for key in ("available", "kind", "reason", "undone_at") if key in raw}


def _recovered(record: JsonObject) -> bool:
    raw = record.get("result") or record.get("summary")
    if not isinstance(raw, str):
        return False
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return False
    return isinstance(data, dict) and data.get("recovered") is True


@with_locale
@validate_params("session_id")
def _effects(params: JsonObject) -> JsonObject:
    receipts = []
    for record in _store().dispatches_for(str(params["session_id"])):
        receipts.append({
            "call_id": record.get("call_id"),
            "method": record.get("method"),
            "channel": record.get("channel"),
            "approval_source": None if record.get("approval_source") == "none" else record.get("approval_source"),
            "status": record.get("status"),
            "recovered": _recovered(record),
            "undo": _undo_summary(record),
        })
    return {"dispatches": receipts}


@with_locale
@validate_params("session_id", "call_id")
def _effect_undo(params: JsonObject) -> JsonObject:
    session_id, call_id = str(params["session_id"]), str(params["call_id"])
    record = _store().get_dispatch(session_id, call_id)
    if record is None:
        raise NotFoundError(f"Acción no encontrada: {call_id}")
    raw_undo = record.get("undo")
    undo = raw_undo if isinstance(raw_undo, dict) else {}
    locks = _locks_for(_resource_lock_keys({}, [undo] if undo.get("path") else []))
    acquired: list[threading.Lock] = []
    try:
        for lock in locks:
            lock.acquire()
            acquired.append(lock)
        return _store().undo_effect(session_id, call_id)
    except ValueError as err:
        raise ValidationError(str(err)) from err
    except OSError as err:
        raise ValidationError(f"No se pudo deshacer la acción: {err}") from err
    finally:
        _release(acquired)


@with_locale
@validate_params("session_id", "call_id", "op_id", "result")
def _dispatch_finish(params: JsonObject) -> JsonObject:
    try:
        return _finish_native(params)
    finally:
        with _inflight_lock:
            leased = _native_leases.pop(str(params["op_id"]), [])
        _release(leased)


def _finish_native(params: JsonObject) -> JsonObject:
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
                    added = store.add_artifact(session_id, artifact)
                    payload["artifact"] = added
                    store.dispatch_note(session_id, str(params["op_id"]), {"artifact_id": added["id"]})
                    result = json.dumps(payload, ensure_ascii=False)
        except (ValueError, OSError) as err:
            result = json.dumps({"error": str(err)}, ensure_ascii=False)
    status = "failed" if _agent.result_failed(result) else "succeeded"
    if params.get("uncertain") is True:
        status = "uncertain"
    _store().dispatch_finish(session_id, call_id, str(params["op_id"]), status, result)
    if record.get("status") in {"running", "uncertain"}:
        _record_outcome(session_id, str(record.get("method") or ""), status)
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


def _workspace_path(session_id: str) -> str | None:
    store = _store()
    workspace = store.workspace_dir(session_id)
    return None if workspace == store.drafts_dir(session_id) else str(workspace)


@with_locale
@validate_params("session_id")
def _artifacts(params: JsonObject) -> JsonObject:
    session_id = str(params["session_id"])
    files = [{"path": str(record["path"]), "folder": record.get("mode") == "folder"}
             for record in _store().grants_for(session_id).values()]
    return {"artifacts": _store().artifacts_for(session_id),
            "questions": _store().questions_for(session_id),
            "context": {"files": sorted(files, key=lambda f: f["path"]), "accounts": _store().accounts_for(session_id),
                        "workspace": _workspace_path(session_id)}}


@with_locale
@validate_params("session_id", "path")
def _grant_remove(params: JsonObject) -> JsonObject:
    return {"removed": _store().revoke_grant(str(params["session_id"]), str(params["path"]))}


@with_locale
@validate_params("session_id", "text")
def _memory_context(params: JsonObject) -> JsonObject:
    raw = params.get("tools")
    tools = raw if isinstance(raw, list) else []
    versions = {str(t["name"]): str(t.get("version") or "") for t in tools if isinstance(t, dict) and t.get("name")}
    memory = _memory()
    templates: set[str] | None = None
    if any(item.get("templates") for item in memory.items() if item["status"] == "active"):
        try:
            templates = {str(t["template_id"]) for t in documents.catalog()["templates"]}
        except Exception:
            logger.warning("No se pudo leer el catálogo de plantillas; la suspensión por plantilla queda desactivada", exc_info=True)
            templates = None
    raw_accounts = params.get("accounts")
    accounts = {str(k): str(v) for k, v in raw_accounts.items() if v} if isinstance(raw_accounts, dict) else {}
    profile_id = params.get("profile_id")
    if profile_id is not None and (not isinstance(profile_id, str) or not profile_id or len(profile_id) > 120):
        raise ValidationError("El perfil de memoria no es válido")
    memory_scope = params.get("memory_scope")
    if memory_scope is not None and memory_scope not in ("shared-read", "own", "none"):
        raise ValidationError("El alcance de memoria no es válido")
    return memory.context(str(params["session_id"]), str(params["text"]), versions, templates, accounts, profile_id,
                          memory_scope)


@with_locale
def _memory_list(params: JsonObject) -> JsonObject:
    return {"items": _memory().items()}


@with_locale
def _skills_list(params: JsonObject) -> JsonObject:
    return skills.library_catalog(_store().base_dir / "skills")


@with_locale
@validate_params("session_id", "skill_id")
def _skill_resolve(params: JsonObject) -> JsonObject:
    session_id = str(params["session_id"])
    profile_id = params.get("profile_id")
    if profile_id is not None and (not isinstance(profile_id, str) or not profile_id or len(profile_id) > 120):
        raise ValidationError("El perfil del agente no es válido")
    store = _store()
    try:
        return {"skill": skills.resolve(params["skill_id"], store.grants_for(session_id), store.drafts_dir(session_id),
                                        store.base_dir / "skills", agent_id=profile_id)}
    except ValueError as err:
        raise ValidationError(str(err)) from err


@with_locale
@validate_params("id", "action")
def _memory_update(params: JsonObject) -> JsonObject:
    try:
        return {"item": _memory().update(str(params["id"]), params)}
    except ValueError as err:
        raise ValidationError(str(err)) from err


@with_locale
@validate_params("id")
def _memory_delete(params: JsonObject) -> JsonObject:
    if not _memory().delete(str(params["id"])):
        raise NotFoundError("El recuerdo ya no existe")
    return {"deleted": True}


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
    return {"approval": _approval_ensure({**params, "channel": "documents"})["approval"]}


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
    "agent_internal_profile_usage": _profile_usage,
    "agent_internal_approval_ensure": _approval_ensure,
    "agent_internal_approval_status": _approval_status,
    "agent_internal_approval_decide": _approval_decide,
    "agent_internal_approvals_pending": _approvals_pending,
    "agent_internal_approvals_history": _approvals_history,
    "agent_internal_approvals_deny_session": _approvals_deny_session,
    "agent_internal_dispatch": _dispatch,
    "agent_internal_dispatch_result": _dispatch_result,
    "agent_internal_dispatch_cancel": _dispatch_cancel,
    "agent_internal_dispatch_finish": _dispatch_finish,
    "agent_internal_effects": _effects,
    "agent_internal_effect_undo": _effect_undo,
    "agent_internal_grants_add": _grants_add,
    "agent_internal_grants_check": _grants_check,
    "agent_internal_grants_list": _grants_list,
    "agent_internal_grants_revoke": _grants_revoke,
    "agent_internal_path_status": _path_status,
    "agent_internal_file_preview": _file_preview,
    "agent_internal_shell_job_status": _shell_job_status,
    "agent_internal_shell_jobs_cancel_session": _shell_jobs_cancel_session,
    "agent_internal_mentions": _mentions,
    "agent_internal_document_plan": _document_plan,
    "agent_canvas_fill": canvas_edit.fill_fields,
    "agent_canvas_apply_layers": canvas_edit.apply_layers,
    "agent_internal_artifacts": _artifacts,
    "agent_internal_artifact_action": _artifact_action,
    "agent_internal_artifact_effect": _artifact_effect,
    "agent_internal_activity": _activity,
    "agent_question_answer": _question_answer,
    "agent_internal_memory_context": _memory_context,
    "agent_internal_grant_remove": _grant_remove,
    "agent_internal_workspace_set": _workspace_set,
    "agent_memory_list": _memory_list,
    "agent_skills_list": _skills_list,
    "agent_internal_skill_resolve": _skill_resolve,
    "agent_memory_update": _memory_update,
    "agent_memory_delete": _memory_delete,
}
