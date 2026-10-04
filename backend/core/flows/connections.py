"""Vault de conexiones del backend: espejo de los tokens que Electron
gestiona vía OAuth (``electron/connections-*.js``) y refresco autónomo para
los nodos ``http_request`` con ``connection_ref``.

Los specs de los proveedores viven en ``shared/connections-catalog.json`` —
el mismo documento que usa Electron para el flujo OAuth.
"""

from __future__ import annotations

import base64
import json
import logging
import time
import urllib.parse
import urllib.request
from pathlib import Path

from backend.core.flows import http_guard, vault
from backend.core.flows.types import JsonObject
from backend.utils.paths import resource_path, user_data_path

logger = logging.getLogger(__name__)

_CATALOG_PATH = resource_path("shared/connections-catalog.json")
_TOKEN_EXPIRY_SKEW_MS = 60_000
_HTTP_TIMEOUT_S = 20.0


def load_provider_specs() -> dict[str, JsonObject]:
    try:
        data: JsonObject = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    providers = data.get("providers") if isinstance(data, dict) else None
    return dict(providers) if isinstance(providers, dict) else {}


def provider_ids() -> list[str]:
    return sorted(load_provider_specs())


def get_provider(provider: str) -> JsonObject:
    spec = load_provider_specs().get(provider)
    if not isinstance(spec, dict):
        raise ValueError(f"Proveedor de conexión desconocido: {provider}")
    return spec


def _vault_path(provider: str) -> Path:
    safe = "".join(ch for ch in provider if ch.isalnum() or ch in "-_")[:64]
    if not safe:
        raise ValueError("provider inválido")
    return user_data_path(f"connections/{safe}.json")


def put_tokens(provider: str, tokens: JsonObject) -> JsonObject:
    get_provider(provider)
    payload: JsonObject = {
        "access_token": tokens.get("access_token"),
        "refresh_token": tokens.get("refresh_token"),
        "expiry_date": tokens.get("expiry_date"),
        "scope": tokens.get("scope"),
        "account": tokens.get("account"),
        "client_id": tokens.get("client_id"),
        "client_secret": tokens.get("client_secret"),
    }
    vault.seal(provider, _vault_path(provider), payload)
    return {"stored": True, "provider": provider}


def get_tokens(provider: str) -> JsonObject | None:
    return vault.open_sealed(provider, _vault_path(provider))


def delete_tokens(provider: str) -> JsonObject:
    vault.clear(_vault_path(provider))
    return {"deleted": True, "provider": provider}


def status(provider: str) -> JsonObject:
    tokens = get_tokens(provider)
    return {
        "provider": provider,
        "connected": bool(tokens and tokens.get("access_token")),
        "expiry_date": (tokens or {}).get("expiry_date"),
        "account": (tokens or {}).get("account"),
    }


def _post_form(url: str, fields: dict[str, str], basic: tuple[str, str] | None) -> JsonObject:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Antares/connections",
    }
    if basic is not None:
        raw = f"{basic[0]}:{basic[1]}".encode()
        headers["Authorization"] = "Basic " + base64.b64encode(raw).decode("ascii")
    body = urllib.parse.urlencode(fields).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with http_guard.no_redirect_opener.open(req, timeout=_HTTP_TIMEOUT_S) as res:
        data: JsonObject = json.loads(res.read().decode("utf-8"))
        return data


def _refresh(provider: str, spec: JsonObject, tokens: JsonObject) -> JsonObject:
    refresh_token = tokens.get("refresh_token")
    client_id = tokens.get("client_id")
    client_secret = tokens.get("client_secret")
    if not refresh_token or not client_id:
        raise ValueError("reauth_required")
    auth = spec.get("auth") or {}
    token_url = auth.get("token_url")
    if not isinstance(token_url, str) or not token_url:
        raise ValueError("reauth_required")
    fields = {
        "grant_type": "refresh_token",
        "refresh_token": str(refresh_token),
        "client_id": str(client_id),
    }
    basic = None
    if auth.get("token_auth") == "basic" and client_secret:
        basic = (str(client_id), str(client_secret))
    elif client_secret:
        fields["client_secret"] = str(client_secret)
    data = _post_form(token_url, fields, basic)
    if not isinstance(data, dict) or not data.get("access_token"):
        raise ValueError(f"El proveedor no devolvió access_token al refrescar ({provider})")
    updated = {
        **tokens,
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token") or refresh_token,
        "expiry_date": int(time.time() * 1000) + int(data.get("expires_in", 3600)) * 1000,
        "scope": data.get("scope") or tokens.get("scope"),
    }
    vault.seal(provider, _vault_path(provider), updated)
    return updated


def fresh_access_token(provider: str) -> str:
    """Access token válido, refrescando si caducó. ValueError si requiere reauth."""
    get_provider(provider)
    tokens = get_tokens(provider)
    if not tokens or not isinstance(tokens.get("access_token"), str) or not tokens["access_token"]:
        raise ValueError(f"Sin conexión activa para {provider}; conéctalo desde Flujos → Conexiones")
    expiry = tokens.get("expiry_date")
    # Sin expiry declarada (tokens OAuth no caducables, p. ej. GitHub) el token se usa tal cual.
    expired = isinstance(expiry, (int, float)) and expiry < time.time() * 1000 + _TOKEN_EXPIRY_SKEW_MS
    if expired:
        try:
            tokens = _refresh(provider, get_provider(provider), tokens)
        except Exception as err:
            raise ValueError(
                f"La conexión con {provider} caducó y no se pudo refrescar; reconéctala en Conexiones"
            ) from err
    return str(tokens["access_token"])


def list_statuses() -> list[JsonObject]:
    out = []
    for pid in provider_ids():
        out.append(status(pid))
    return out
