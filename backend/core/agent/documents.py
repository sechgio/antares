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
    "match_key": {"type": "string", "description": "Columna que identifica las fotos de cada registro"},
    "match_date": {"type": "string", "description": "Columna de fecha para distinguir fotos"},
    "photos_folder": {"type": "string", "description": "Carpeta de fotos que el usuario adjuntó"},
    "images_per_panel": {"type": "integer", "description": "Fotos obligatorias por registro"},
    "photo_selections": {"type": "object", "description": "record_key → nombres de fotos elegidas"},
    "number_from": {"type": "integer"},
    "number_to": {"type": "integer"},
    "output_mode": {"type": "string", "enum": ["consolidado", "individual"]},
    "filename_pattern": {"type": "string", "description": "Nombre del PDF, admite {CAMPO}"},
    "color_mode": {"type": "string", "enum": ["rgb", "cmyk"], "description": "Canvas: RGB conserva la fidelidad de la pantalla; CMYK usa el motor de impresión"},
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
        "name": "file_read",
        "gated": False,
        "description": (
            "Documentos · file_read (solo lectura): lee un archivo que el usuario nombró o un borrador: texto de "
            "PDF por página, columnas y filas de Excel/CSV, o datos básicos de una imagen"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "max_rows": {"type": "integer", "description": "Filas a devolver (máx. 200)"},
            },
            "required": ["path"],
        },
    },
    {
        "name": "artifacts_list",
        "gated": False,
        "description": "Documentos · artifacts_list (solo lectura): documentos generados en esta conversación",
        "inputSchema": {"type": "object", "properties": {}},
    },
]
READ_TOOLS = frozenset(spec["name"] for spec in TOOL_SPECS)


_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
_MAX_PDF_PAGES = 30
_MAX_PAGE_CHARS = 4_000
_MAX_FILE_BYTES = 100 * 1024 * 1024


def read_file(params: JsonObject, grants: dict[str, JsonObject], root: Path) -> JsonObject:
    """Contenido de un archivo concedido o borrador, con su procedencia (ruta y revisión)."""
    value = params.get("path")
    if not isinstance(value, str) or not value:
        raise ValueError("Indica la ruta del archivo")
    draft = drafts.inside(root, value)
    if draft is not None and draft.is_file():
        stat = draft.stat()
        source: JsonObject = {"path": str(draft), "size": stat.st_size, "mtime_ns": stat.st_mtime_ns}
    else:
        source = resource_grants.check(value, grants)
    path = Path(str(source["path"]))
    if int(source["size"]) > _MAX_FILE_BYTES:
        raise ValueError("El archivo excede 100 MiB")
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        import pymupdf

        with pymupdf.open(path) as document:
            pages = [
                {"page": i + 1, "text": page.get_text()[:_MAX_PAGE_CHARS]}
                for i, page in enumerate(document) if i < _MAX_PDF_PAGES
            ]
            total = len(document)
        empty = not any(p["text"].strip() for p in pages)
        return {"source": source, "kind": "pdf", "pages": total, "content": pages,
                **({"note": "El PDF no tiene texto extraíble (posible escaneo); pide los datos al usuario"} if empty else {})}
    if suffix in {".csv", ".xlsx", ".xlsm", ".xls"}:
        limit = params.get("max_rows", 50)
        limit = max(1, min(200, limit if isinstance(limit, int) and not isinstance(limit, bool) else 50))
        rows = _sheet_rows(path)
        columns = list(dict.fromkeys(key for row in rows for key in row))
        return {"source": source, "kind": "spreadsheet", "columns": columns, "total_rows": len(rows),
                "rows": rows[:limit]}
    if suffix in _IMAGE_SUFFIXES:
        from PIL import Image

        with Image.open(path) as image:
            width, height = image.size
        return {"source": source, "kind": "image", "width": width, "height": height,
                "note": "El agente no interpreta el contenido de la imagen; pide al usuario los datos que necesites"}
    raise ValueError("Formato no admitido: usa PDF, Excel/CSV o imágenes")


def _sheet_rows(path: Path) -> list[JsonObject]:
    if path.suffix.lower() == ".csv":
        import csv

        from backend.handlers.spreadsheet import _sniff_csv

        encoding, delimiter = _sniff_csv(path)
        with path.open("r", encoding=encoding, newline="") as handle:
            return [dict(row) for row in csv.DictReader(handle, delimiter=delimiter) if any(row.values())][:5000]
    from backend.core.panel_aviso_corte import parse_excel_bytes

    return [dict(row) for row in parse_excel_bytes(path.read_bytes(), path.name).rows][:5000]


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
    if params.get("rows") is not None and (not isinstance(params["rows"], list) or any(not isinstance(row, dict) for row in params["rows"])):
        raise ValueError("Las filas del documento deben ser una lista de registros")
    if params.get("color_mode") == "cmyk" and family != "canvas":
        raise ValueError("El modo CMYK está disponible para plantillas de Canvas")
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
    folders: list[str] = []
    if params.get("photos_folder"):
        folder = resource_grants.check_folder(str(params["photos_folder"]), grants)
        folders.append(folder)
        sources.append({"kind": "photos_folder", "path": folder})
    workflow: JsonObject = {
        key: params[key] for key in ("rows", "records_source", "field_mappings", "field_values", "row_values",
                                     "match_key", "match_date", "photo_selections", "number_from", "number_to",
                                     "output_mode", "filename_pattern")
        if key in params
    }
    workflow.update({
        "template_kind": family,
        "template_id": template_id,
        "images_per_panel": params.get("images_per_panel", 0) if folders else 0,
        "output_folder": str(root),
        "_flow_file_grants": path_grants.authorize_paths({"read": read, "write": [str(root)], "folders": folders}),
        "preview_pdf": False,
    })
    if folders:
        workflow["source_folder"] = folders[0]
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
    public["columns"] = list(result.get("headers") or [])
    public["pending"] = list(result.get("pending") or [])[:_MAX_PENDING]
    public["records"] = len(result.get("preview") or [])
    public["preview"] = [
        {"record_key": row.get("record_key"), "data": row.get("data"), "photos": row.get("images"),
         "errors": row.get("errors")}
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


def render_plan(params: JsonObject, grants: dict[str, JsonObject], root: Path) -> JsonObject:
    """Entradas verificadas para el renderer existente; nunca se envían al modelo."""
    family, template_id = _template(params)
    if family == "formato" or params.get("color_mode") == "cmyk":
        result, artifact = generate(params, grants, root)
        return {"complete": True, "result": result, "artifact": artifact}
    workflow, sources = _workflow_params(params, grants, root)
    prepared = pdf_workflow.prepare(workflow)
    if not prepared.get("ready"):
        return {"complete": True, "result": {**_public(prepared), "generated": False}}
    args = prepared["pdf_args"]
    contexts = args["contexts"]
    batches = [[ctx] for ctx in contexts] if args["output_mode"] == "individual" else [contexts]
    items = []
    for target, batch in zip(pdf_workflow.output_paths(args), batches, strict=True):
        item: JsonObject = {"filename": Path(target).name}
        if family == "html":
            parts = [[ctx] for ctx in batch] if pdf_workflow.template_profile(family, template_id)["root_fields"] else [batch]
            item["htmls"] = [pdf_workflow._render({**args, "contexts": part, "_html_only": True}).decode("utf-8") for part in parts]
        else:
            from backend.handlers.canvas import canvas_get
            from backend.utils.image_data import build_image_uris

            document = canvas_get({"id": template_id})["document"]
            if pdf_workflow.template_profile(family, template_id)["version"] != args["template_version"]:
                raise ValueError("La plantilla cambió; vuelve a preparar el documento")
            paths = args.get("localImagePaths") or {}
            if any(hashlib.sha256(Path(path).read_bytes()).hexdigest() != args["photo_digests"].get(ref) for ref, path in paths.items()):
                raise ValueError("Las fotos cambiaron; vuelve a preparar el documento")
            uris = build_image_uris({}, paths)
            item.update({"document": document, "contexts": [{**ctx, "images": [uris[ref] for ref in ctx.get("images") or []]} for ctx in batch]})
        items.append(item)
    return {"items": items, "metadata": {"family": family, "template_id": template_id,
            "template_revision": args["template_version"], "fingerprint": prepared["fingerprint"],
            "sources": sources, "records": len(contexts), "output_mode": args["output_mode"]}}


def native_artifact(result: JsonObject, root: Path, artifact_id: str) -> JsonObject | None:
    paths = result.get("saved_paths") or ([result["saved_path"]] if result.get("saved_path") else [])
    if not paths:
        return None
    files = []
    for raw in paths:
        path = drafts.inside(root, str(raw))
        if path is None:
            raise ValueError("El PDF nativo está fuera de los borradores de esta conversación")
        files.append(_verify_pdf(path))
    return {**(result.get("artifact_metadata") or {}), "id": artifact_id, "files": files}
