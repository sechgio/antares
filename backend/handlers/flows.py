from __future__ import annotations

import logging

from backend.core import flows as _flows_core
from backend.core.exceptions import NotFoundError, ValidationError
from backend.core.flows import ai_providers as _ai_providers
from backend.core.flows import connections as _connections
from backend.core.flows.runner import FlowRunner, cancel_run
from backend.core.flows.store import FlowStore
from backend.core.flows.types import JsonObject
from backend.core.ipc_catalog import ORCHESTRATABLE_METHODS
from backend.handlers import HANDLERS as _REGISTRY
from backend.handlers.common import get_item_id, validate_params, with_locale

logger = logging.getLogger(__name__)

_runner = FlowRunner(_flows_core.get_flow_store(), _REGISTRY.get)


def _store() -> FlowStore:
    return _flows_core.get_flow_store()


def _flow_or_raise(flow_id: str) -> JsonObject:
    flow = _store().get(flow_id)
    if flow is None:
        raise NotFoundError(f"Flujo no encontrado: {flow_id}")
    return flow


@with_locale
def _list(params: JsonObject) -> JsonObject:
    return {"flows": _store().list_flows()}


@with_locale
@validate_params("id")
def _get(params: JsonObject) -> JsonObject:
    return {"flow": _flow_or_raise(get_item_id(params))}


@with_locale
def _create(params: JsonObject) -> JsonObject:
    name = str(params.get("name") or "Sin nombre")[:120]
    description = params.get("description")
    graph = params.get("graph")
    try:
        flow = _store().create(
            name,
            graph=graph if isinstance(graph, dict) else None,
            description=str(description) if isinstance(description, str) else "",
        )
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    return {"flow": flow}


@with_locale
@validate_params("id")
def _update(params: JsonObject) -> JsonObject:
    flow_id = get_item_id(params)
    graph = params.get("graph")
    enabled = params.get("enabled")
    try:
        flow = _store().update(
            flow_id,
            name=params.get("name") if isinstance(params.get("name"), str) else None,
            description=params.get("description") if isinstance(params.get("description"), str) else None,
            enabled=bool(enabled) if enabled is not None else None,
            graph=graph if isinstance(graph, dict) else None,
            expected_updated_at=params.get("expected_updated_at")
            if isinstance(params.get("expected_updated_at"), str)
            else None,
        )
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    if flow is None:
        raise NotFoundError(f"Flujo no encontrado: {flow_id}")
    return {"flow": flow}


@with_locale
@validate_params("id")
def _delete(params: JsonObject) -> JsonObject:
    flow_id = get_item_id(params)
    if not _store().delete(flow_id):
        raise NotFoundError(f"Flujo no encontrado: {flow_id}")
    return {"deleted": True, "id": flow_id}


@with_locale
@validate_params("id")
def _duplicate(params: JsonObject) -> JsonObject:
    flow_id = get_item_id(params)
    name = params.get("name")
    flow = _store().duplicate(flow_id, name if isinstance(name, str) else None)
    if flow is None:
        raise NotFoundError(f"Flujo no encontrado: {flow_id}")
    return {"flow": flow}


@with_locale
@validate_params("id")
def _run(params: JsonObject) -> JsonObject:
    flow_id = get_item_id(params)
    _flow_or_raise(flow_id)
    trigger_payload = params.get("trigger_payload")
    try:
        run = _runner.start(flow_id, trigger_payload if isinstance(trigger_payload, dict) else None)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    return {"run": run}


@with_locale
@validate_params("run_id")
def _run_status(params: JsonObject) -> JsonObject:
    run = _store().get_run(str(params["run_id"]))
    if run is None:
        raise NotFoundError(f"Run no encontrado: {params['run_id']}")
    return {"run": run}


@with_locale
def _runs_list(params: JsonObject) -> JsonObject:
    flow_id = params.get("flow_id")
    limit = params.get("limit")
    runs = _store().list_runs(
        str(flow_id) if isinstance(flow_id, str) and flow_id else None,
        min(int(limit), 200) if isinstance(limit, (int, float)) else 50,
    )
    return {"runs": runs}


@with_locale
@validate_params("run_id")
def _run_cancel(params: JsonObject) -> JsonObject:
    run_id = str(params["run_id"])
    run = _store().get_run(run_id)
    if run is None:
        raise NotFoundError(f"Run no encontrado: {run_id}")
    if run["status"] in ("success", "error", "cancelled"):
        return {"run": run, "cancelled": False}
    if not cancel_run(run_id):
        return {"run": run, "cancelled": False}
    return {"run": _store().get_run(run_id), "cancelled": True}


@with_locale
def _orchestratable_methods(params: JsonObject) -> JsonObject:
    return {"methods": sorted(ORCHESTRATABLE_METHODS)}


@with_locale
@validate_params("provider", "tokens")
def _connection_token_put(params: JsonObject) -> JsonObject:
    """Espeja tokens OAuth gestionados por Electron en el vault del backend,
    para que los nodos http_request puedan firmar con connection_ref."""
    provider = str(params["provider"])
    tokens = params["tokens"]
    if not isinstance(tokens, dict) or not isinstance(tokens.get("access_token"), str):
        raise ValidationError("tokens debe contener access_token")
    try:
        return _connections.put_tokens(provider, dict(tokens))
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc


@with_locale
@validate_params("provider")
def _connection_token_delete(params: JsonObject) -> JsonObject:
    provider = str(params["provider"])
    try:
        return _connections.delete_tokens(provider)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc


@with_locale
def _ai_providers_list(params: JsonObject) -> JsonObject:
    specs = _ai_providers.load_provider_specs()
    providers = []
    for pid in sorted(specs):
        spec = specs[pid]
        providers.append(
            {
                "id": pid,
                "label": spec.get("label", pid),
                "description": spec.get("description", ""),
                "docs": spec.get("docs", ""),
                "editable_base_url": bool(spec.get("editable_base_url")),
                "default_base_url": spec.get("base_url", ""),
                **_ai_providers.public_state(pid),
            }
        )
    return {"providers": providers}


@with_locale
@validate_params("provider")
def _ai_provider_save(params: JsonObject) -> JsonObject:
    provider = str(params["provider"])
    config: JsonObject = {k: params[k] for k in ("api_key", "base_url") if k in params}
    try:
        _ai_providers.put_config(provider, config)
        return {"provider": _ai_providers.public_state(provider)}
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc


@with_locale
@validate_params("provider")
def _ai_provider_delete(params: JsonObject) -> JsonObject:
    try:
        return _ai_providers.delete_config(str(params["provider"]))
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc


@with_locale
@validate_params("provider")
def _ai_provider_status(params: JsonObject) -> JsonObject:
    try:
        return {"provider": _ai_providers.status(str(params["provider"]))}
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc


HANDLERS = {
    "flows_list": _list,
    "flows_get": _get,
    "flows_create": _create,
    "flows_update": _update,
    "flows_delete": _delete,
    "flows_duplicate": _duplicate,
    "flows_run": _run,
    "flows_run_status": _run_status,
    "flows_runs_list": _runs_list,
    "flows_run_cancel": _run_cancel,
    "flows_orchestratable_methods": _orchestratable_methods,
    "flows_connection_token_put": _connection_token_put,
    "flows_connection_token_delete": _connection_token_delete,
    "ai_providers_list": _ai_providers_list,
    "ai_provider_save": _ai_provider_save,
    "ai_provider_delete": _ai_provider_delete,
    "ai_provider_status": _ai_provider_status,
}
