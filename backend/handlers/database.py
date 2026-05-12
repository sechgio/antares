"""Database and field/pattern configuration handlers."""
from __future__ import annotations
from pathlib import Path
from typing import Any
from backend.handlers.common import with_locale, validate_params
from backend.core.config_fields import get_field_names, load_fields, save_fields
from backend.core.config_patterns import load_patterns, save_patterns
from backend.core.config_patterns import reset_to_defaults as reset_patterns_defaults
from backend.core.converter import FORMATOS_SOPORTADOS, VIDEO_FORMATS
from backend.core.database import (
    buscar_por_codigo, exportar_excel, generar_plantilla_excel,
    importar_excel, limpiar_base_datos, obtener_todos,
)

@with_locale
def db_records(params: dict[str, Any]) -> dict[str, Any]:
    return {"records": obtener_todos(), "fields": get_field_names()}

@with_locale
@validate_params('path')
def db_import(params: dict[str, Any]) -> dict[str, int]:
    return {"imported": importar_excel(params.get("path", ""))}

@with_locale
@validate_params('path')
def db_export(params: dict[str, Any]) -> dict[str, int]:
    return {"exported": exportar_excel(params.get("path", ""))}

@with_locale
def db_clear(params: dict[str, Any]) -> dict[str, int]:
    return {"cleared": limpiar_base_datos()}

@with_locale
@validate_params('path')
def db_template(params: dict[str, Any]) -> dict[str, Any]:
    path = params.get("path", "")
    if path and not path.lower().endswith('.xlsx'):
        path = path + '.xlsx'
    generar_plantilla_excel(path)
    return {"path": path}

@with_locale
@validate_params('folder')
def scan_folder(params: dict[str, Any]) -> dict[str, list[str]]:
    folder = params.get("folder", "")
    path = Path(folder)
    if not path.is_dir():
        raise ValueError(f"Directorio no encontrado o no válido: {folder}")
    exts: set[str] = set()
    for info in FORMATOS_SOPORTADOS.values():
        exts.update(e.lower() for e in info["ext"])
        exts.update(e.upper() for e in info["ext"])
    for ext in VIDEO_FORMATS.values():
        exts.add(ext.lower())
        exts.add(ext.upper())
    files = [str(f.resolve()) for f in path.rglob("*") if f.is_file() and f.suffix in exts]
    return {"files": files}

@with_locale
def db_fields(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    return {"fields": load_fields()}

@with_locale
def db_fields_update(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    fields = params.get("fields", [])
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
def rename_patterns_get(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    return {"patterns": load_patterns()}

@with_locale
def rename_patterns_update(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    return {"patterns": save_patterns(params.get("patterns", []))}

@with_locale
def rename_patterns_reset(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    return {"patterns": reset_patterns_defaults()}

HANDLERS = {
    "db_records": db_records,
    "db_import": db_import,
    "db_export": db_export,
    "db_clear": db_clear,
    "db_template": db_template,
    "scan_folder": scan_folder,
    "db_fields": db_fields,
    "db_fields_update": db_fields_update,
    "db_fields_reset": db_fields_reset,
    "rename_patterns_get": rename_patterns_get,
    "rename_patterns_update": rename_patterns_update,
    "rename_patterns_reset": rename_patterns_reset,
}
