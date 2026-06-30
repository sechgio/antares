"""Database and field/pattern configuration handlers."""
from __future__ import annotations

from typing import Any

from backend.core.config_fields import get_field_names, load_fields, save_fields
from backend.core.config_patterns import load_patterns, save_patterns
from backend.core.config_patterns import reset_to_defaults as reset_patterns_defaults
from backend.core.database import (
    exportar_excel,
    generar_plantilla_excel,
    importar_excel,
    limpiar_base_datos,
    obtener_todos,
    parse_id_rename_mapping_full,
)
from backend.handlers.common import validate_params, with_locale


@with_locale
def db_records(params: dict[str, Any]) -> dict[str, Any]:
    return {"records": obtener_todos(), "fields": get_field_names()}

@with_locale
@validate_params("path")
def db_import(params: dict[str, Any]) -> dict[str, int]:
    return {"imported": importar_excel(params.get("path", ""))}

@with_locale
@validate_params("path")
def db_export(params: dict[str, Any]) -> dict[str, int]:
    return {"exported": exportar_excel(params.get("path", ""))}

@with_locale
def db_clear(params: dict[str, Any]) -> dict[str, int]:
    return {"cleared": limpiar_base_datos()}

@with_locale
@validate_params("path")
def db_template(params: dict[str, Any]) -> dict[str, Any]:
    path = params.get("path", "")
    if path and not path.lower().endswith(".xlsx"):
        path = path + ".xlsx"
    generar_plantilla_excel(path)
    return {"path": path}

@with_locale
def db_fields(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    return {"fields": load_fields()}

@with_locale
def db_fields_update(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    fields = params.get("fields") or []
    result = save_fields(fields)
    from backend.core.database import init_db
    init_db()
    return {"fields": result}

@with_locale
def db_fields_reset(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    from backend.core.config_fields import reset_to_defaults
    result = reset_to_defaults()
    from backend.core.database import init_db
    init_db()
    return {"fields": result}

@with_locale
@validate_params("path")
def db_parse_mapping(params: dict[str, Any]) -> dict[str, Any]:
    """Parsea un Excel ID→RENOMBRE sin tocar la BD del catálogo."""
    from backend.core.mapping_index import MappingIndex

    excel_path = params.get("path", "")
    id_column = params.get("id_column") or None
    rename_column = params.get("rename_column") or None
    parsed = parse_id_rename_mapping_full(excel_path, id_column, rename_column)
    mapping = parsed["mapping"]
    files = params.get("files") or []
    stats = MappingIndex(mapping).compute_stats(files)

    return {
        "mapping": mapping,
        "id_column": parsed["id_column"],
        "rename_column": parsed["rename_column"],
        "columns": parsed["columns"],
        **stats,
    }


@with_locale
def db_validate_mapping(params: dict[str, Any]) -> dict[str, Any]:
    """Valida un mapeo ya cargado contra una lista de archivos (sin releer Excel)."""
    from backend.core.mapping_index import MappingIndex

    mapping = params.get("mapping") or {}
    if not isinstance(mapping, dict):
        msg = "El mapeo debe ser un diccionario ID → RENOMBRE"
        raise ValueError(msg)
    files = params.get("files") or []
    stats = MappingIndex(mapping).compute_stats(files)
    return {"mapping": mapping, **stats}


@with_locale
def db_columns(params: dict[str, Any]) -> dict[str, Any]:
    """Retorna las columnas disponibles en la BD con datos de muestra."""
    from backend.core.database import obtener_todos
    fields = get_field_names()
    records = obtener_todos(limit=100)
    return {"columns": fields, "records": records, "total": len(records)}

@with_locale
def rename_patterns_get(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    return {"patterns": load_patterns()}

@with_locale
def rename_patterns_update(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    return {"patterns": save_patterns(params.get("patterns") or [])}

@with_locale
def rename_patterns_reset(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    return {"patterns": reset_patterns_defaults()}

HANDLERS = {
    "db_records": db_records,
    "db_import": db_import,
    "db_export": db_export,
    "db_clear": db_clear,
    "db_template": db_template,
    "db_fields": db_fields,
    "db_fields_update": db_fields_update,
    "db_fields_reset": db_fields_reset,
    "db_parse_mapping": db_parse_mapping,
    "db_validate_mapping": db_validate_mapping,
    "db_columns": db_columns,
    "rename_patterns_get": rename_patterns_get,
    "rename_patterns_update": rename_patterns_update,
    "rename_patterns_reset": rename_patterns_reset,
}
