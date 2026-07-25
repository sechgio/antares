"""IPC handlers for the Canvas tool."""

from __future__ import annotations

from typing import Any

from backend.core import canvas as _canvas_core
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
        msg = f"Document not found: {doc_id}"
        raise ValueError(msg)
    return {"document": document}


@with_locale
@validate_params("document")
def canvas_save(params: dict[str, Any]) -> dict[str, Any]:
    document = params["document"]
    if not isinstance(document, dict):
        msg = "document must be an object"
        raise ValueError(msg)
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
        msg = f"Document not found: {doc_id}"
        raise ValueError(msg)
    return {"success": True, "deleted_id": doc_id}


@with_locale
@validate_params("id")
def canvas_duplicate(params: dict[str, Any]) -> dict[str, Any]:
    doc_id = str(params["id"])
    name = params.get("name")
    document = _canvas_core.get_canvas_store().duplicate(doc_id, name=str(name) if name else None)
    return {"document": document}


HANDLERS = {
    "canvas_list": canvas_list,
    "canvas_get": canvas_get,
    "canvas_save": canvas_save,
    "canvas_create": canvas_create,
    "canvas_delete": canvas_delete,
    "canvas_duplicate": canvas_duplicate,
}
