"""Proveedores de modelos IA (BYOK): claves y base URL selladas en el
mismo vault que las conexiones OAuth (``core/integrations/vault.py``).

Los specs viven en ``shared/ai-providers-catalog.json``. Además, el usuario
puede añadir modelos personalizados: su spec y su clave se sellan juntos en
``ai-providers/custom-*.json`` y se fusionan con el catálogo. La API key nunca
sale del backend: al renderer solo se expone una versión enmascarada.
"""

from __future__ import annotations

import http.client
import json
import logging
import re
import secrets
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from backend.core.integrations import http_guard, vault
from backend.core.integrations.types import JsonObject
from backend.utils.paths import resource_path, user_data_path

logger = logging.getLogger(__name__)

_CATALOG_PATH = resource_path("shared/ai-providers-catalog.json")
_HTTP_TIMEOUT_S = 15.0
_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
_CUSTOM_PREFIX = "custom-"
_CUSTOM_LABEL_MAX = 60
_CUSTOM_MODEL_MAX = 128
_MAX_STATUS_MODELS = 300

_CUSTOM_APIS: dict[str, JsonObject] = {
    "openai": {
        "label": "OpenAI compatible (Chat Completions)",
        "auth": {"type": "api_key", "header": "Authorization", "prefix": "Bearer ", "extra_headers": {}},
        "status": {"path": "/models", "models_field": "data"},
        "chat": {"path": "/chat/completions", "style": "openai_chat"},
    },
    "anthropic": {
        "label": "Anthropic Messages",
        "auth": {
            "type": "api_key",
            "header": "x-api-key",
            "prefix": "",
            "extra_headers": {"anthropic-version": "2023-06-01"},
        },
        "status": {"path": "/v1/models", "models_field": "data"},
        "chat": {"path": "/v1/messages", "style": "anthropic_messages"},
    },
}


def _custom_payload(provider: str) -> JsonObject | None:
    if not provider.startswith(_CUSTOM_PREFIX):
        return None
    try:
        payload = vault.open_sealed(provider, _vault_path(provider))
    except (OSError, ValueError):
        logger.warning("Vault de modelo personalizado corrupto: %s", provider)
        return None
    return payload if isinstance(payload, dict) and payload.get("custom") is True else None


def _custom_spec(payload: JsonObject) -> JsonObject | None:
    api = payload.get("api")
    preset = _CUSTOM_APIS.get(api) if isinstance(api, str) else None
    label = payload.get("label")
    model = payload.get("model")
    base_url = payload.get("base_url")
    if preset is None or not all(isinstance(value, str) and value for value in (label, model, base_url)):
        return None
    auth = dict(preset["auth"])
    if not payload.get("api_key"):
        auth["type"] = "none"
    return {
        "label": label,
        "description": f"Modelo personalizado · {preset['label']}",
        "docs": "",
        "editable_base_url": True,
        "base_url": base_url,
        "auth": auth,
        "status": dict(preset["status"]),
        "chat": {**preset["chat"], "default_model": model},
        "custom": True,
        "api": api,
    }


def _custom_paths() -> list[tuple[str, Path]]:
    paths: list[tuple[str, Path]] = []
    for path in sorted(user_data_path("ai-providers").glob(f"{_CUSTOM_PREFIX}*.json")):
        provider = path.stem[:64]
        if re.fullmatch(r"[A-Za-z0-9_-]+", provider):
            paths.append((provider, path))
    return paths


def custom_provider_specs() -> dict[str, JsonObject]:
    """Specs de los modelos personalizados válidos, indexados por id."""
    specs: dict[str, JsonObject] = {}
    for provider, _ in _custom_paths():
        payload = _custom_payload(provider)
        spec = _custom_spec(payload) if payload is not None else None
        if spec is not None:
            specs[provider] = spec
    return specs


def invalid_custom_providers() -> list[str]:
    """Ids de archivos custom presentes pero ilegibles o incompletos."""
    invalid: list[str] = []
    for provider, _ in _custom_paths():
        payload = _custom_payload(provider)
        if payload is None or _custom_spec(payload) is None:
            invalid.append(provider)
    return invalid


def _catalog_specs() -> dict[str, JsonObject]:
    try:
        data: JsonObject = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    providers = data.get("providers") if isinstance(data, dict) else None
    return dict(providers) if isinstance(providers, dict) else {}


def load_provider_specs() -> dict[str, JsonObject]:
    specs = _catalog_specs()
    specs.update(custom_provider_specs())
    return specs


def get_provider(provider: str) -> JsonObject:
    spec = _catalog_specs().get(provider)
    if isinstance(spec, dict):
        return spec
    payload = _custom_payload(provider)
    custom = _custom_spec(payload) if payload is not None else None
    if custom is None:
        raise ValueError(f"Proveedor de IA desconocido: {provider}")
    return custom


def _vault_path(provider: str) -> Path:
    safe = "".join(ch for ch in provider if ch.isalnum() or ch in "-_")[:64]
    if not safe:
        raise ValueError("provider inválido")
    return user_data_path(f"ai-providers/{safe}.json")


def _validate_base_url(url: str) -> str:
    url = url.strip().rstrip("/")
    try:
        parsed = urllib.parse.urlsplit(url)
        port = parsed.port
        valid = (
            parsed.scheme in ("http", "https") and bool(parsed.hostname)
            and parsed.username is None and parsed.password is None
            and not parsed.query and not parsed.fragment
            and not any(ch.isspace() for ch in url)
            and (port is None or port > 0)
        )
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("base_url debe ser una URL http(s) válida, sin credenciales, parámetros ni fragmentos")
    return url


def endpoint_url(base: str, path: str) -> str:
    base = base.rstrip("/")
    if base.endswith("/v1") and path.startswith("/v1/"):
        path = path[3:]
    return f"{base}{path}"


def put_config(provider: str, config: JsonObject) -> JsonObject:
    get_provider(provider)
    existing = get_config(provider) or {}
    payload = dict(existing)
    api_key = config.get("api_key")
    if api_key is not None:
        if not isinstance(api_key, str) or not api_key.strip():
            raise ValueError("api_key debe ser un texto no vacío")
        stripped = api_key.strip()
        if "\n" in stripped or "\r" in stripped:
            raise ValueError("La clave no puede contener saltos de línea")
        payload["api_key"] = stripped
    base_url = config.get("base_url")
    if base_url is not None:
        if not isinstance(base_url, str) or not base_url.strip():
            payload.pop("base_url", None)
        else:
            payload["base_url"] = _validate_base_url(base_url)
    model = config.get("model")
    if model is not None:
        if not isinstance(model, str) or len(model.strip()) > 120:
            raise ValueError("El modelo debe ser un texto de hasta 120 caracteres")
        model = model.strip()
        if model:
            payload["model"] = model
        else:
            payload.pop("model", None)
    vault.seal(provider, _vault_path(provider), payload)
    return {"stored": True, "provider": provider}


def get_config(provider: str) -> JsonObject | None:
    if provider.startswith(_CUSTOM_PREFIX):
        return _custom_payload(provider)
    return vault.open_sealed(provider, _vault_path(provider))


def _custom_text(value: object, limit: int, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} es obligatorio")
    text = value.strip()
    if len(text) > limit:
        raise ValueError(f"{name} admite hasta {limit} caracteres")
    if "\n" in text or "\r" in text:
        raise ValueError(f"{name} no puede contener saltos de línea")
    return text


def _new_custom_id(label: str) -> str:
    ascii_label = unicodedata.normalize("NFKD", label).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_label.lower()).strip("-")[:40] or "modelo"
    for _ in range(5):
        candidate = f"{_CUSTOM_PREFIX}{slug}-{secrets.token_hex(3)}"
        if not _vault_path(candidate).exists():
            return candidate
    raise ValueError("No se pudo generar un identificador para el modelo personalizado")


def upsert_custom(config: JsonObject) -> JsonObject:
    """Crea o actualiza un modelo personalizado con su spec y clave sellados.

    Sin ``id`` crea uno nuevo con id derivado del nombre; con ``id`` actualiza.
    Omitir ``api_key`` conserva la clave guardada, igual que ``put_config``.
    """
    raw_id = config.get("id")
    if raw_id is not None and not isinstance(raw_id, str):
        raise ValueError("id debe ser un texto")
    provider = raw_id.strip() if isinstance(raw_id, str) else ""
    existing: JsonObject = {}
    if provider:
        payload = _custom_payload(provider)
        if payload is None:
            raise ValueError(f"Modelo personalizado desconocido: {provider}")
        existing = payload
    label = _custom_text(config.get("label"), _CUSTOM_LABEL_MAX, "El nombre")
    api = config.get("api")
    if not isinstance(api, str) or api not in _CUSTOM_APIS:
        raise ValueError("El formato de API debe ser openai o anthropic")
    base_url = config.get("base_url")
    if not isinstance(base_url, str) or not base_url.strip():
        raise ValueError("La dirección base es obligatoria")
    saved: JsonObject = {
        **existing,
        "custom": True,
        "label": label,
        "api": api,
        "base_url": _validate_base_url(base_url),
        "model": _custom_text(config.get("model"), _CUSTOM_MODEL_MAX, "El modelo"),
    }
    if config.get("remove_key") is True:
        saved.pop("api_key", None)
    api_key = config.get("api_key")
    if api_key is not None:
        if not isinstance(api_key, str):
            raise ValueError("api_key debe ser un texto no vacío")
        stripped = api_key.strip()
        if "\n" in stripped or "\r" in stripped:
            raise ValueError("La clave no puede contener saltos de línea")
        if stripped:
            saved["api_key"] = stripped
    if not provider:
        provider = _new_custom_id(label)
    saved["id"] = provider
    vault.seal(provider, _vault_path(provider), saved)
    return {"id": provider, "provider": public_state(provider)}


def delete_config(provider: str) -> JsonObject:
    if not provider.startswith(_CUSTOM_PREFIX):
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
    config = get_config(provider) or {}
    key = config.get("api_key")
    return {
        "provider": provider,
        "configured": bool(config),
        "has_key": bool(isinstance(key, str) and key),
        "key_masked": _mask_key(key) if isinstance(key, str) and key else None,
        "base_url": _base_url(provider, spec, config),
        "default_model": config.get("model") or (spec.get("chat") or {}).get("default_model", ""),
        "needs_key": (spec.get("auth") or {}).get("type") == "api_key",
    }


def _get_json(url: str, headers: dict[str, str]) -> JsonObject:
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "Antares/ai-providers", **headers},
        method="GET",
    )
    with http_guard.no_redirect_opener.open(req, timeout=_HTTP_TIMEOUT_S) as res:
        raw = res.read(_MAX_RESPONSE_BYTES + 1)
        if len(raw) > _MAX_RESPONSE_BYTES:
            raise ValueError("La respuesta del proveedor supera el tamaño máximo permitido")
        data: JsonObject = json.loads(raw.decode("utf-8"))
        return data


def _status_model_ids(models: list[object]) -> list[str]:
    """Identificadores utilizables del listado del proveedor, sin duplicados.

    OpenAI devuelve ``id`` y Ollama ``name``; cualquier otra forma se descarta.
    El tope evita que un catálogo enorme (OpenRouter) viaje al renderer.
    """
    seen: set[str] = set()
    out: list[str] = []
    for item in models:
        raw = (item.get("id") or item.get("name")) if isinstance(item, dict) else item
        if not isinstance(raw, str):
            continue
        value = raw.strip()[:120]
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
        if len(out) >= _MAX_STATUS_MODELS:
            break
    return out


def status(provider: str) -> JsonObject:
    """Sonda el endpoint de modelos del proveedor con la clave guardada."""
    spec = get_provider(provider)
    state = public_state(provider)
    out: JsonObject = {
        **state,
        "reachable": False,
        "models_count": None,
        "models": [],
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

    headers: dict[str, str] = {
        str(key): str(value) for key, value in (auth.get("extra_headers") or {}).items()
    }
    if auth.get("type") == "api_key":
        config = get_config(provider) or {}
        api_key = config.get("api_key")
        if not isinstance(api_key, str) or not api_key:
            out["error"] = "Falta la API key; guárdala primero"
            return out
        header = auth.get("header") or "Authorization"
        prefix = auth.get("prefix") if isinstance(auth.get("prefix"), str) else ""
        headers[str(header)] = f"{prefix}{api_key}"

    url = endpoint_url(str(state["base_url"]), path)
    try:
        data = _get_json(url, headers)
    except urllib.error.HTTPError as err:
        out["error"] = (
            "El proveedor no ofrece un listado de modelos. Puedes usarlo con el nombre de modelo indicado por el servicio."
            if err.code in (404, 405) else f"HTTP {err.code} al consultar el proveedor"
        )
        return out
    except (urllib.error.URLError, OSError, http.client.HTTPException, ValueError) as err:
        detail = getattr(err, "reason", err)
        out["error"] = f"Sin respuesta del proveedor: {detail}"
        return out

    models = data.get(str(status_spec.get("models_field") or "")) if isinstance(data, dict) else None
    if not isinstance(models, list):
        out["error"] = "El proveedor no devolvió un listado de modelos válido"
        return out
    out["reachable"] = True
    out["models_count"] = len(models)
    out["models"] = _status_model_ids(models)
    return out
