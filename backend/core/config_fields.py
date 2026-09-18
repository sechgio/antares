
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

from backend.core.config_store import JsonConfigStore
from backend.core.repository import _db_schema_lock
from backend.utils.paths import cached_config_path

logger = logging.getLogger(__name__)

DEFAULT_FIELDS: list[dict[str, Any]] = [
    {"name": "codigo", "type": "TEXT", "required": True, "unique": True},
    {"name": "nombre", "type": "TEXT", "required": False, "unique": False},
    {"name": "categoria", "type": "TEXT", "required": False, "unique": False},
    {"name": "marca", "type": "TEXT", "required": False, "unique": False},
    {"name": "modelo", "type": "TEXT", "required": False, "unique": False},
    {"name": "descripcion", "type": "TEXT", "required": False, "unique": False},
]

_SQLITE_KEYWORDS: set[str] = {
    "abort", "action", "add", "after", "all", "alter", "analyze", "and", "as",
    "asc", "attach", "autoincrement", "before", "begin", "between", "by", "cascade",
    "case", "cast", "check", "collate", "column", "commit", "conflict", "constraint",
    "create", "cross", "current", "current_date", "current_time", "current_timestamp",
    "database", "default", "deferrable", "deferred", "delete", "desc", "detach",
    "distinct", "drop", "each", "else", "end", "escape", "except", "exclusive",
    "exists", "explain", "fail", "for", "foreign", "from", "full", "glob", "group",
    "having", "if", "ignore", "immediate", "in", "index", "indexed", "initially",
    "inner", "insert", "instead", "intersect", "into", "is", "isnull", "join", "key",
    "left", "like", "limit", "match", "natural", "no", "not", "notnull", "null", "of",
    "offset", "on", "or", "order", "outer", "plan", "pragma", "primary", "query",
    "raise", "recursive", "references", "regexp", "reindex", "release", "rename",
    "replace", "restrict", "right", "rollback", "row", "savepoint", "select", "set",
    "table", "temp", "temporary", "then", "to", "transaction", "trigger", "union",
    "unique", "update", "using", "vacuum", "values", "view", "virtual", "when",
    "where", "with", "without",
}

_RESERVED_FIELD_NAMES: frozenset[str] = frozenset({"id"})

_CONFIG_PATH: Path | None = None


def _config_file() -> Path:
    global _CONFIG_PATH
    if _CONFIG_PATH is None:
        _CONFIG_PATH = cached_config_path("fields", "fields_config.json")
    return _CONFIG_PATH


def _validar_nombre_campo(nombre: str) -> bool:
    if not nombre:
        return False
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", nombre):
        return False
    return nombre not in _RESERVED_FIELD_NAMES and nombre not in _SQLITE_KEYWORDS


def _validar_tipo_campo(tipo: str) -> bool:
    return tipo.upper() in {"TEXT", "INTEGER", "REAL", "BLOB", "NUMERIC"}


def sanitize_field_defs(fields: list[dict[str, Any]]) -> list[dict[str, Any]]:
    validated: list[dict[str, Any]] = []
    for f in fields:
        if isinstance(f, dict) and "name" in f and "type" in f:
            nombre = str(f["name"]).strip().lower()
            tipo = str(f["type"]).strip().upper()
            if not _validar_nombre_campo(nombre) or not _validar_tipo_campo(tipo):
                continue
            validated.append({
                "name": nombre,
                "type": tipo,
                "required": bool(f.get("required", False)),
                "unique": bool(f.get("unique", False)),
            })
    return validated


def _parse_fields_payload(data: Any) -> list[dict[str, Any]] | None:
    fields = data.get("fields", [])
    if fields and isinstance(fields, list):
        validated = sanitize_field_defs(fields)
        if validated:
            return validated
    return None


_store: JsonConfigStore[list[dict[str, Any]]] = JsonConfigStore(
    lambda: _config_file(),
    default=lambda: [dict(f) for f in DEFAULT_FIELDS],
    parse=_parse_fields_payload,
    serialize=lambda fields: {"fields": fields},
    label="configuración de campos",
)

_cached_field_names: tuple[Path, list[str]] | None = None


def _invalidate_fields_cache() -> None:
    global _cached_field_names
    with _db_schema_lock.write():
        _store.invalidate()
        _cached_field_names = None


def load_fields() -> list[dict[str, Any]]:
    with _db_schema_lock.read():
        return _store.load()


def save_fields(fields: list[dict[str, Any]]) -> list[dict[str, Any]]:
    with _db_schema_lock.write():
        validated = sanitize_field_defs(fields)
        _store.save(validated)
        global _cached_field_names
        _cached_field_names = None
        return validated


def get_field_names() -> list[str]:
    global _cached_field_names
    with _db_schema_lock.read():
        path = _config_file()
        if _cached_field_names is not None and _cached_field_names[0] == path:
            return list(_cached_field_names[1])
        names = [f["name"] for f in load_fields()]
        _cached_field_names = (path, names)
        return list(names)


def reset_to_defaults() -> list[dict[str, Any]]:
    return save_fields(DEFAULT_FIELDS)
