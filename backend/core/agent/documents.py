"""Documentos del agente: catálogo de plantillas de las tres familias y generación.

Reutiliza el motor guiado (``pdf_workflow``): plantillas HTML de Reportes,
documentos de Canvas y Formatos PDF numerados. Las plantillas se descubren en
cada llamada desde el catálogo de su familia, así que una plantilla nueva
compatible queda disponible sin tocar el prompt. Los datos salen de una hoja
CSV/XLSX que el humano nombró (o de un borrador de la conversación), de
registros guardados de Antares o de filas que dicta el usuario; los campos que
faltan se informan en lugar de inventarse. El PDF se genera en los borradores
y queda registrado como artefacto con su hash, la revisión de la plantilla y
sus fuentes.
"""

from __future__ import annotations

import hashlib
import uuid
from pathlib import Path
from typing import Any

from backend.core.agent import drafts, path_grants, pdf_workflow, resource_grants
from backend.core.integrations.types import JsonObject

FAMILIES = ("html", "canvas", "formato")
_MAX_PREVIEW_ROWS = 20
_MAX_PENDING = 50
_RECORD_SOURCES = ("technical_reports", "informes_v2", "fichas_tecnicas")

_DATA_PROPERTIES: dict[str, Any] = {  # allowlist: dict[str, Any]
    "family": {"type": "string", "enum": list(FAMILIES), "description": "html, canvas o formato"},
    "template_id": {"type": "string", "description": "ID de la plantilla (ver templates_catalog)"},
    "spreadsheet_path": {"type": "string", "description": "Excel/CSV que el usuario nombró o un borrador"},
    "records_source": {"type": "string", "enum": list(_RECORD_SOURCES), "description": "Registros guardados de Antares"},
    "rows": {"type": "array", "items": {"type": "object"}, "description": "Filas dictadas por el usuario"},
    "field_mappings": {"type": "object", "description": "Campo de la plantilla → columna de la hoja"},
    "field_values": {"type": "object", "description": "Valores comunes a todos los registros"},
    "row_values": {"type": "object", "description": "Correcciones por registro (record_key → campos)"},
    "match_key": {"type": "string"},
    "number_from": {"type": "integer"},
    "number_to": {"type": "integer"},
    "output_mode": {"type": "string", "enum": ["consolidado", "individual"]},
    "filename_pattern": {"type": "string", "description": "Nombre del PDF, admite {CAMPO}"},
}

TOOL_SPECS: list[JsonObject] = [
    {
        "name": "templates_catalog",
        "gated": False,
        "description": "Documentos · templates_catalog (solo lectura): plantillas HTML, Canvas y Formatos PDF disponibles",
        "inputSchema": {"type": "object", "properties": {"family": _DATA_PROPERTIES["family"]}},
    },
    {
        "name": "template_describe",
        "gated": False,
        "description": "Documentos · template_describe (solo lectura): campos, obligatorios, fotos y revisión de una plantilla",
        "inputSchema": {"type": "object", "properties": {k: _DATA_PROPERTIES[k] for k in ("family", "template_id")},
                        "required": ["family", "template_id"]},
    },
    {
        "name": "document_prepare",
        "gated": False,
        "description": (
            "Documentos · document_prepare (solo lectura): valida datos contra la plantilla, sugiere el mapeo de "
            "columnas y lista los campos que faltan, sin generar archivos"
        ),
        "inputSchema": {"type": "object", "properties": _DATA_PROPERTIES, "required": ["family", "template_id"]},
    },
    {
        "name": "document_generate",
        "gated": False,
        "description": (
            "Documentos · document_generate (borrador sin aprobación): genera el PDF en los borradores de la "
            "conversación con el motor de la plantilla y lo registra como artefacto"
        ),
        "inputSchema": {"type": "object", "properties": _DATA_PROPERTIES,
                        "required": ["family", "template_id", "filename_pattern"]},
    },
    {
        "name": "artifacts_list",
        "gated": False,
        "description": "Documentos · artifacts_list (solo lectura): documentos generados en esta conversación",
        "inputSchema": {"type": "object", "properties": {}},
    },
]
READ_TOOLS = frozenset(spec["name"] for spec in TOOL_SPECS)


def catalog(family: str | None = None) -> JsonObject:
    from backend.core.formatos import list_formats
    from backend.handlers.canvas import canvas_list
    from backend.handlers.templates import templates_list

    items: list[JsonObject] = []
    if family in (None, "html"):
        items += [{"family": "html", "template_id": t["name"], "name": t["name"]}
                  for t in templates_list({"recursive": True})["templates"]]
    if family in (None, "canvas"):
        items += [{"family": "canvas", "template_id": d["id"], "name": d.get("name") or d["id"]}
                  for d in canvas_list({})["documents"]]
    if family in (None, "formato"):
        items += [{"family": "formato", "template_id": f["id"], "name": f.get("name") or f["id"]}
                  for f in list_formats()]
    if family not in (None, *FAMILIES):
        raise ValueError("La familia debe ser html, canvas o formato")
    return {"templates": items}


def describe(params: JsonObject) -> JsonObject:
    family, template_id = _template(params)
    profile = pdf_workflow.template_profile(family, template_id)
    return {
        "family": family,
        "template_id": template_id,
        "revision": profile["version"],
        "fields": profile["fields"],
        "required_fields": profile["required_fields"],
        "field_labels": profile.get("field_labels") or {},
        "image_limit": profile["image_limit"],
    }


def _template(params: JsonObject) -> tuple[str, str]:
    family = str(params.get("family") or "")
    template_id = str(params.get("template_id") or "")
    if family not in FAMILIES:
        raise ValueError("Indica la familia de la plantilla: html, canvas o formato")
    if not template_id:
        raise ValueError("Indica la plantilla (ver templates_catalog)")
    return family, template_id


def _workflow_params(params: JsonObject, grants: dict[str, JsonObject], root: Path) -> tuple[JsonObject, list[JsonObject]]:
    family, template_id = _template(params)
    sources: list[JsonObject] = []
    read: list[str] = []
    sheet_value = params.get("spreadsheet_path")
    sheet = None
    if sheet_value:
        if not isinstance(sheet_value, str):
            raise ValueError("La hoja de datos debe ser una ruta")
        draft = drafts.inside(root, sheet_value)
        if draft is not None and draft.is_file():
            stat = draft.stat()
            sheet = str(draft)
            sources.append({"kind": "spreadsheet", "path": sheet, "size": stat.st_size, "mtime_ns": stat.st_mtime_ns})
        else:
            revision = resource_grants.check(sheet_value, grants)
            sheet = str(revision["path"])
            sources.append({"kind": "spreadsheet", **revision})
        read.append(sheet)
    if params.get("records_source"):
        if params["records_source"] not in _RECORD_SOURCES:
            raise ValueError("Los registros deben ser technical_reports, informes_v2 o fichas_tecnicas")
        sources.append({"kind": "records", "source": params["records_source"]})
    if params.get("rows") is not None:
        sources.append({"kind": "rows", "count": len(params["rows"]) if isinstance(params["rows"], list) else 0})
    root.mkdir(parents=True, exist_ok=True)
    workflow: JsonObject = {
        key: params[key] for key in ("rows", "records_source", "field_mappings", "field_values", "row_values",
                                     "match_key", "number_from", "number_to", "output_mode", "filename_pattern")
        if key in params
    }
    workflow.update({
        "template_kind": family,
        "template_id": template_id,
        "images_per_panel": 0,
        "output_folder": str(root),
        "_flow_file_grants": path_grants.authorize_paths({"read": read, "write": [str(root)], "folders": []}),
        "preview_pdf": False,
    })
    if sheet:
        workflow["spreadsheet_path"] = sheet
    return workflow, sources


def prepare(params: JsonObject, grants: dict[str, JsonObject], root: Path) -> JsonObject:
    workflow, _ = _workflow_params(params, grants, root)
    result = pdf_workflow.prepare(workflow)
    return _public(result)


def _public(result: JsonObject) -> JsonObject:
    """Proyección para el modelo: sin contextos internos, rutas de fotos ni argumentos del motor."""
    keys = ("ready", "reason", "suggested_mappings", "required_fields", "field_labels",
            "match_key", "fingerprint", "output_names")
    public = {key: result[key] for key in keys if key in result}
    public["columns"] = list(result.get("headers") or [])  # "headers" se oculta como posible secreto
    public["pending"] = list(result.get("pending") or [])[:_MAX_PENDING]
    public["records"] = len(result.get("preview") or [])
    public["preview"] = [
        {"record_key": row.get("record_key"), "data": row.get("data"), "errors": row.get("errors")}
        for row in (result.get("preview") or [])[:_MAX_PREVIEW_ROWS]
    ]
    return public


def generate(params: JsonObject, grants: dict[str, JsonObject], root: Path) -> tuple[JsonObject, JsonObject | None]:
    """Genera el PDF en los borradores; devuelve (resultado, artefacto registrado o None)."""
    workflow, sources = _workflow_params(params, grants, root)
    prepared = pdf_workflow.prepare(workflow)
    if not prepared.get("ready"):
        return {**_public(prepared), "generated": False}, None
    exported = pdf_workflow.export_pdf(prepared["pdf_args"])
    if not exported.get("ready"):
        return {"generated": False, "reason": exported.get("reason")}, None
    files = [_verify_pdf(Path(path)) for path in exported["saved_paths"]]
    family, template_id = _template(params)
    artifact: JsonObject = {
        "id": uuid.uuid4().hex[:12],
        "family": family,
        "template_id": template_id,
        "template_revision": prepared["pdf_args"]["template_version"],
        "fingerprint": prepared["fingerprint"],
        "records": len(prepared.get("contexts") or []),
        "output_mode": prepared["pdf_args"]["output_mode"],
        "sources": sources,
        "files": files,
    }
    return {"generated": True, "artifact": artifact}, artifact


def _verify_pdf(path: Path) -> JsonObject:
    import pymupdf

    data = path.read_bytes()
    with pymupdf.open(stream=data, filetype="pdf") as document:
        pages = len(document)
    if pages < 1:
        raise ValueError(f"El PDF {path.name} no tiene páginas")
    return {"path": str(path), "name": path.name, "mime": "application/pdf", "size": len(data),
            "sha256": hashlib.sha256(data).hexdigest(), "pages": pages}
