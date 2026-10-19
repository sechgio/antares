"""Handlers IPC de integraciones: tokens OAuth de Conexiones y proveedores IA.

``connection_token_*`` son internos (``internal`` del catálogo): los llama
Electron para espejar en el vault del backend los tokens OAuth de las cuentas
conectadas y para pedir rotaciones. ``ai_provider_*`` administra la
configuración (clave, base_url, modelo) que el agente y el chat leen del vault.
"""

from __future__ import annotations

from backend.core.exceptions import ValidationError
from backend.core.integrations import ai_providers as _ai_providers
from backend.core.integrations import connections as _connections
from backend.core.integrations.types import JsonObject
from backend.handlers.common import validate_params, with_locale


@with_locale
@validate_params("provider", "tokens")
def _connection_token_put(params: JsonObject) -> JsonObject:
    """Espeja tokens OAuth gestionados por Electron en el vault del backend."""
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
@validate_params("provider")
def _connection_token_refresh(params: JsonObject) -> JsonObject:
    tokens = _connections.fresh_tokens(str(params["provider"]))
    return {"tokens": {key: tokens.get(key) for key in ("access_token", "refresh_token", "expiry_date", "scope", "account")}}


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
    config: JsonObject = {k: params[k] for k in ("api_key", "base_url", "model") if k in params}
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
    "connection_token_put": _connection_token_put,
    "connection_token_delete": _connection_token_delete,
    "connection_token_refresh": _connection_token_refresh,
    "ai_providers_list": _ai_providers_list,
    "ai_provider_save": _ai_provider_save,
    "ai_provider_delete": _ai_provider_delete,
    "ai_provider_status": _ai_provider_status,
}
