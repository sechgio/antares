from __future__ import annotations

import functools
import json
import logging
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError

from backend.utils.paths import resource_path

logger = logging.getLogger(__name__)

_CATALOG_PATH = resource_path("shared/ipc-method-catalog.json")
_CATALOG: dict[str, Any] = json.loads(  # allowlist: dict[str, Any]
    _CATALOG_PATH.read_text(encoding="utf-8")
)
_METHODS: dict[str, dict[str, Any]] = _CATALOG["methods"]  # allowlist: dict[str, Any]


def _entry(method: str) -> dict[str, Any] | None:  # allowlist: dict[str, Any]
    entry = _METHODS.get(method)
    return entry if isinstance(entry, dict) else None


def handler_module_for(method: str) -> str | None:
    entry = _entry(method)
    if entry is None:
        return None
    handler = entry.get("handler")
    if isinstance(handler, str) and handler.startswith("backend:"):
        return f"backend.handlers.{handler[len('backend:'):]}"
    return None


def lane_for(method: str) -> str:
    entry = _entry(method)
    if entry is None or not str(entry.get("handler", "")).startswith("backend:"):
        return "light"
    lane = entry.get("lane")
    return lane if isinstance(lane, str) else "light"


BACKEND_HANDLER_MODULES: frozenset[str] = frozenset(
    mod for mod in (handler_module_for(name) for name in _METHODS) if mod is not None
)

HEAVY_METHODS: frozenset[str] = frozenset(
    name for name, entry in _METHODS.items() if entry.get("lane") == "heavy"
)
SYNC_METHODS: frozenset[str] = frozenset(
    name for name, entry in _METHODS.items() if entry.get("lane") == "sync"
)
IDEMPOTENT_METHODS: frozenset[str] = frozenset(
    name for name, entry in _METHODS.items() if entry.get("idempotent") is True
)
RAW_OUTPUT_PATH_METHODS: frozenset[str] = frozenset(
    name for name, entry in _METHODS.items() if entry.get("rawOutputPath") is True
)
ORCHESTRATABLE_METHODS: frozenset[str] = frozenset(
    name
    for name, entry in _METHODS.items()
    if entry.get("orchestratable") is True
    and str(entry.get("handler", "")).startswith("backend:")
)


def backend_methods() -> frozenset[str]:
    return frozenset(
        name
        for name, entry in _METHODS.items()
        if str(entry.get("handler", "")).startswith("backend:")
    )


def input_schema_for(method: str) -> dict[str, object]:
    entry = _entry(method)
    schema = entry.get("inputSchema") if entry else None
    return schema if isinstance(schema, dict) else {"type": "object", "properties": {}}


@functools.cache
def _schema_validator_for(method: str) -> Any:
    # ipc-bridge-006: el catálogo declara inputSchema por método pero nada lo
    # imponía en el ingress; ahora cada schema declarado se compila una vez y
    # su validador se aplica en el dispatcher de main.py. Los métodos sin
    # inputSchema (o con un schema inválido) se despachan como hasta hoy.
    entry = _entry(method)
    schema = entry.get("inputSchema") if entry else None
    if not isinstance(schema, dict) or not schema:
        return None
    try:
        return Draft202012Validator(schema)
    except SchemaError:
        logger.warning("inputSchema inválido en el catálogo para %s; se ignora", method)
        return None


def validate_params_schema(method: str, params: object) -> str | None:
    """Devuelve None si `params` cumple el inputSchema del catálogo (o el método
    no declara schema); en caso contrario, un mensaje de usuario listo para el
    envelope de error."""
    validator = _schema_validator_for(method)
    if validator is None:
        return None
    value = params if isinstance(params, dict) else {}
    first = next(validator.iter_errors(value), None)
    if first is None:
        return None
    route = "/".join(str(part) for part in first.absolute_path) or "raíz"
    return f"Parámetros inválidos para {method} ({route}): {first.message}"

_TIMEOUTS: dict[str, Any] = _CATALOG.get("timeouts", {})  # allowlist: dict[str, Any]
_DEFAULT_TIMEOUT_MS = 30_000


def timeout_ms_for(method: str) -> int:
    entry = _entry(method)
    tier = entry.get("timeout") if entry else None
    value = _TIMEOUTS.get(tier if isinstance(tier, str) else "normal")
    if not isinstance(value, (int, float)):
        value = _TIMEOUTS.get("normal", _DEFAULT_TIMEOUT_MS)
    return int(value)


def is_idempotent(method: str) -> bool:
    return method in IDEMPOTENT_METHODS


def is_native(method: str) -> bool:
    entry = _entry(method)
    return entry is not None and str(entry.get("handler", "")).startswith("native:")


def file_tokens_for(method: str) -> tuple[tuple[str, ...], ...]:
    entry = _entry(method)
    raw = entry.get("fileTokens") if entry else None
    if not isinstance(raw, list):
        return ()
    return tuple(
        tuple(str(segment) for segment in segments)
        for segments in raw
        if isinstance(segments, list)
    )


def write_path_keys_for(method: str) -> frozenset[str]:
    entry = _entry(method)
    raw = entry.get("writePathKeys") if entry else None
    if not isinstance(raw, list):
        return frozenset()
    return frozenset(str(k) for k in raw)


def allows_raw_output_path(method: str) -> bool:
    return method in RAW_OUTPUT_PATH_METHODS
