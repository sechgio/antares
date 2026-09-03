
from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any

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


_cached_fields: tuple[Path, list[dict[str, Any]]] | None = None
_cached_field_names: tuple[Path, list[str]] | None = None


def _invalidate_fields_cache() -> None:
    global _cached_fields, _cached_field_names
    with _db_schema_lock.write():
        _cached_fields = None
        _cached_field_names = None


def load_fields() -> list[dict[str, Any]]:
    with _db_schema_lock.read():
        return _load_fields_unlocked()


def _load_fields_unlocked() -> list[dict[str, Any]]:
    global _cached_fields
    path = _config_file()
    if _cached_fields is not None:
        cached_path, cached_data = _cached_fields
        if cached_path == path:
            return [dict(f) for f in cached_data]
    if path.exists():
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            fields = data.get("fields", [])
            if fields and isinstance(fields, list):
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
                if validated:
                    _cached_fields = (path, validated)
                    return [dict(f) for f in validated]
        except (json.JSONDecodeError, OSError, TypeError) as exc:
            logger.warning("Error leyendo configuración de campos, usando defaults: %s", exc)
    defaults = [dict(f) for f in DEFAULT_FIELDS]
    _cached_fields = (path, defaults)
    return defaults


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with open(tmp_path, "w", encoding="utf-8") as file:
        json.dump(payload, file, indent=2, ensure_ascii=False)
        file.flush()
        os.fsync(file.fileno())
    os.replace(tmp_path, path)


def save_fields(fields: list[dict[str, Any]]) -> list[dict[str, Any]]:
    with _db_schema_lock.write():
        path = _config_file()
        validated = sanitize_field_defs(fields)
        _atomic_write_json(path, {"fields": validated})
        _invalidate_fields_cache()
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


def get_required_fields() -> list[str]:
    return [f["name"] for f in load_fields() if f.get("required")]


def get_unique_fields() -> list[str]:
    return [f["name"] for f in load_fields() if f.get("unique")]


def reset_to_defaults() -> list[dict[str, Any]]:
    return save_fields(DEFAULT_FIELDS)
