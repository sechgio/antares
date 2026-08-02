"""IPC handlers for the Canvas tool."""

from __future__ import annotations

from typing import Any

from backend.core import canvas as _canvas_core
from backend.core.exceptions import NotFoundError, ValidationError
from backend.handlers.common import validate_params, with_locale


@with_locale
def canvas_list(params: dict[str, Any]) -> dict[str, Any]:
    return {"documents": _canvas_core.get_canvas_store().list_documents()}


@with_locale
@validate_params("id")
def canvas_get(params: dict[str, Any]) -> dict[str, Any]:
    doc_id = str(params["id"])
    document = _canvas_core.get_canvas_store().get(doc_id)
    if document is None:
        raise NotFoundError("Documento no encontrado")
    return {"document": document}


@with_locale
@validate_params("document")
def canvas_save(params: dict[str, Any]) -> dict[str, Any]:
    document = params["document"]
    if not isinstance(document, dict):
        raise ValidationError("document debe ser un objeto")
    touch = params.get("touch", True)
    if not isinstance(touch, bool):
        touch = True
    saved = _canvas_core.get_canvas_store().save(document, touch=touch)
    return {"document": saved}


@with_locale
def canvas_create(params: dict[str, Any]) -> dict[str, Any]:
    name = str(params.get("name") or "Sin título")
    document = _canvas_core.get_canvas_store().create(name=name)
    return {"document": document}


@with_locale
@validate_params("id")
def canvas_delete(params: dict[str, Any]) -> dict[str, Any]:
    doc_id = str(params["id"])
    deleted = _canvas_core.get_canvas_store().delete(doc_id)
    if not deleted:
        raise NotFoundError("Documento no encontrado")
    return {"success": True, "deleted_id": doc_id}


@with_locale
@validate_params("id")
def canvas_duplicate(params: dict[str, Any]) -> dict[str, Any]:
    doc_id = str(params["id"])
    name = params.get("name")
    document = _canvas_core.get_canvas_store().duplicate(doc_id, name=str(name) if name else None)
    return {"document": document}


@with_locale
@validate_params("document")
def canvas_export_cmyk_pdf(params: dict[str, Any]) -> dict[str, Any]:
    import base64
    from pathlib import Path

    from backend.core.cmyk_pdf import CanvasCmykRenderer

    document = params["document"]
    contexts = params.get("contexts") or [{}]
    color_profile = str(params.get("color_profile") or "cmyk_iso_coated_v2")
    dpi = int(params.get("dpi") or 300)
    bleed_mm = float(params.get("bleed_mm") or 0.0)
    show_crop_marks = bool(params.get("show_crop_marks", False))
    pair_context_pages = bool(params.get("pair_context_pages", False))
    filename = str(params.get("filename") or "canvas_cmyk.pdf")
    output_path = params.get("outputPath")
    local_image_paths = params.get("localImagePaths") or {}

    renderer = CanvasCmykRenderer(
        document=document,
        contexts=contexts,
        color_profile=color_profile,
        dpi=dpi,
        bleed_mm=bleed_mm,
        show_crop_marks=show_crop_marks,
        pair_context_pages=pair_context_pages,
    )
    pdf_bytes = renderer.render(local_image_paths=local_image_paths)

    if output_path:
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(pdf_bytes)
        # Mirror formatos/sellador: skip Base64 when writing to disk so large
        # CMYK PDFs do not bounce through the 64 MB JSON-RPC IPC ceiling.
        return {
            "filename": out.name,
            "saved_path": str(out),
        }

    encoded = base64.b64encode(pdf_bytes).decode("ascii")
    return {
        "filename": filename,
        "pdf_base64": encoded,
    }


@with_locale
@validate_params("id")
def canvas_get_history(params: dict[str, Any]) -> dict[str, Any]:
    doc_id = str(params["id"])
    history_data = _canvas_core.get_canvas_store().get_history(doc_id)
    return history_data


@with_locale
@validate_params("id")
def canvas_save_history(params: dict[str, Any]) -> dict[str, Any]:
    doc_id = str(params["id"])
    past = params.get("past") or []
    future = params.get("future") or []
    if not isinstance(past, list) or not isinstance(future, list):
        msg = "past and future must be arrays"
        raise ValueError(msg)
    _canvas_core.get_canvas_store().save_history(doc_id, past, future)
    return {"success": True}


HANDLERS = {
    "canvas_list": canvas_list,
    "canvas_get": canvas_get,
    "canvas_save": canvas_save,
    "canvas_create": canvas_create,
    "canvas_delete": canvas_delete,
    "canvas_duplicate": canvas_duplicate,
    "canvas_export_cmyk_pdf": canvas_export_cmyk_pdf,
    "canvas_get_history": canvas_get_history,
    "canvas_save_history": canvas_save_history,
}

