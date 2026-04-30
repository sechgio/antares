"""Configuración personalizable de campos de base de datos."""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from backend.utils.paths import user_data_path

logger = logging.getLogger(__name__)

DEFAULT_FIELDS: list[dict[str, Any]] = [
    {"name": "codigo", "type": "TEXT", "required": True, "unique": True},
    {"name": "nombre", "type": "TEXT", "required": False, "unique": False},
    {"name": "categoria", "type": "TEXT", "required": False, "unique": False},
    {"name": "marca", "type": "TEXT", "required": False, "unique": False},
    {"name": "modelo", "type": "TEXT", "required": False, "unique": False},
    {"name": "descripcion", "type": "TEXT", "required": False, "unique": False},
]

# SQLite keywords que no deben usarse como nombres de columna
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

_CONFIG_PATH: Path | None = None


def _config_file() -> Path:
    global _CONFIG_PATH
    if _CONFIG_PATH is None:
        _CONFIG_PATH = user_data_path("fields_config.json")
    return _CONFIG_PATH


def _validar_nombre_campo(nombre: str) -> bool:
    """Valida que el nombre sea seguro para SQL: alfanumérico + guiones bajos, sin keywords."""
    if not nombre:
        return False
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", nombre):
        return False
    return nombre not in _SQLITE_KEYWORDS


def _validar_tipo_campo(tipo: str) -> bool:
    """Valida que el tipo sea un tipo SQLite permitido."""
    return tipo.upper() in {"TEXT", "INTEGER", "REAL", "BLOB", "NUMERIC"}


def load_fields() -> list[dict[str, Any]]:
    """Carga la configuración de campos desde disco o retorna los defaults."""
    path = _config_file()
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
                    return validated
        except (json.JSONDecodeError, OSError, TypeError) as exc:
            logger.warning("Error leyendo configuración de campos, usando defaults: %s", exc)
    return [dict(f) for f in DEFAULT_FIELDS]


def save_fields(fields: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Guarda la configuración de campos en disco."""
    path = _config_file()
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
    with open(path, "w", encoding="utf-8") as file:
        json.dump({"fields": validated}, file, indent=2, ensure_ascii=False)
    return validated


def get_field_names() -> list[str]:
    """Retorna lista de nombres de campos."""
    return [f["name"] for f in load_fields()]


def get_required_fields() -> list[str]:
    """Retorna lista de campos requeridos."""
    return [f["name"] for f in load_fields() if f.get("required")]


def get_unique_fields() -> list[str]:
    """Retorna lista de campos únicos."""
    return [f["name"] for f in load_fields() if f.get("unique")]


def reset_to_defaults() -> list[dict[str, Any]]:
    """Restaura la configuración a los valores por defecto."""
    save_fields(DEFAULT_FIELDS)
    return [dict(f) for f in DEFAULT_FIELDS]
