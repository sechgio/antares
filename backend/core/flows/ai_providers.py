"""Proveedores de modelos IA (BYOK): claves y base URL selladas en el
mismo vault que las conexiones OAuth (``core/flows/vault.py``).

Los specs viven en ``shared/ai-providers-catalog.json``. La API key nunca
sale del backend: al renderer solo se expone una versión enmascarada.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from pathlib import Path

from backend.core.flows import http_guard, vault
from backend.core.flows.types import JsonObject
from backend.utils.paths import resource_path, user_data_path

logger = logging.getLogger(__name__)

_CATALOG_PATH = resource_path("shared/ai-providers-catalog.json")
_HTTP_TIMEOUT_S = 15.0


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
        raise ValueError(f"Proveedor de IA desconocido: {provider}")
    return spec


def _vault_path(provider: str) -> Path:
    safe = "".join(ch for ch in provider if ch.isalnum() or ch in "-_")[:64]
    if not safe:
        raise ValueError("provider inválido")
    return user_data_path(f"ai-providers/{safe}.json")


def _validate_base_url(url: str) -> str:
    url = url.strip().rstrip("/")
    scheme = url.split(":", 1)[0].lower()
    if scheme not in ("http", "https") or "://" not in url:
        raise ValueError("base_url debe ser una URL http(s) válida")
    return url


def put_config(provider: str, config: JsonObject) -> JsonObject:
    get_provider(provider)
    existing = get_config(provider) or {}
    payload = dict(existing)
    api_key = config.get("api_key")
    if api_key is not None:
        if not isinstance(api_key, str) or not api_key.strip():
            raise ValueError("api_key debe ser un texto no vacío")
        payload["api_key"] = api_key.strip()
    base_url = config.get("base_url")
    if base_url is not None:
        if not isinstance(base_url, str) or not base_url.strip():
            payload.pop("base_url", None)
        else:
            payload["base_url"] = _validate_base_url(base_url)
    vault.seal(provider, _vault_path(provider), payload)
    return {"stored": True, "provider": provider}


def get_config(provider: str) -> JsonObject | None:
    return vault.open_sealed(provider, _vault_path(provider))


def delete_config(provider: str) -> JsonObject:
    get_provider(provider)
    vault.clear(_vault_path(provider))
    return {"deleted": True, "provider": provider}


def _mask_key(key: str) -> str:
    return f"••••{key[-4:]}" if len(key) >= 4 else "••••"


def _base_url(provider: str, spec: JsonObject, config: JsonObject | None) -> str:
    saved = (config or {}).get("base_url")
    if isinstance(saved, str) and saved:
        return saved
    default = spec.get("base_url")
    return default if isinstance(default, str) else ""


def public_state(provider: str) -> JsonObject:
    """Estado visible para el renderer: nunca incluye la clave."""
    spec = get_provider(provider)
    config = get_config(provider)
    key = (config or {}).get("api_key")
    return {
        "provider": provider,
        "configured": bool(config),
        "has_key": bool(isinstance(key, str) and key),
        "key_masked": _mask_key(key) if isinstance(key, str) and key else None,
        "base_url": _base_url(provider, spec, config),
        "needs_key": (spec.get("auth") or {}).get("type") == "api_key",
    }


def _get_json(url: str, headers: dict[str, str]) -> JsonObject:
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "Antares/ai-providers", **headers},
        method="GET",
    )
    with http_guard.no_redirect_opener.open(req, timeout=_HTTP_TIMEOUT_S) as res:
        data: JsonObject = json.loads(res.read().decode("utf-8"))
        return data


def status(provider: str) -> JsonObject:
    """Sonda el endpoint de modelos del proveedor con la clave guardada."""
    spec = get_provider(provider)
    state = public_state(provider)
    out: JsonObject = {
        **state,
        "reachable": False,
        "models_count": None,
        "error": None,
    }
    auth = spec.get("auth") or {}
    status_spec = spec.get("status") or {}
    path = status_spec.get("path")
    if not isinstance(path, str) or not path.startswith("/"):
        out["error"] = "El proveedor no declara endpoint de estado"
        return out
    if not state["base_url"]:
        out["error"] = "Falta base_url"
        return out

    headers: dict[str, str] = {}
    for key, value in (auth.get("extra_headers") or {}).items():
        headers[str(key)] = str(value)
    if auth.get("type") == "api_key":
        config = get_config(provider) or {}
        api_key = config.get("api_key")
        if not isinstance(api_key, str) or not api_key:
            out["error"] = "Falta la API key; guárdala primero"
            return out
        header = auth.get("header") or "Authorization"
        prefix = auth.get("prefix") if isinstance(auth.get("prefix"), str) else ""
        headers[str(header)] = f"{prefix}{api_key}"

    url = f"{state['base_url']}{path}"
    try:
        data = _get_json(url, headers)
    except urllib.error.HTTPError as err:
        out["error"] = f"HTTP {err.code} al consultar el proveedor"
        return out
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as err:
        detail = getattr(err, "reason", err)
        out["error"] = f"Sin respuesta del proveedor: {detail}"
        return out

    models = data.get(str(status_spec.get("models_field") or ""))
    out["reachable"] = True
    out["models_count"] = len(models) if isinstance(models, list) else None
    return out


def list_states() -> list[JsonObject]:
    return [public_state(pid) for pid in provider_ids()]
