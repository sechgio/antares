from __future__ import annotations

import base64
import logging
from typing import Any, cast

from backend.core.design import generate as design_generate_module
from backend.core.design import models
from backend.core.design.memory import get_design_memory
from backend.core.design.qa import run_preflight
from backend.core.design.render import render_html
from backend.core.design.store import get_design_store
from backend.core.design.types import JsonObject
from backend.core.exceptions import NotFoundError, ValidationError
from backend.core.observability import log_event
from backend.handlers.common import validate_params, with_locale
from backend.utils.atomic_write import atomic_output_file
from backend.utils.pdf_html import write_pdf_sanitized
from backend.utils.validators import sanitizar_nombre

logger = logging.getLogger(__name__)

MAX_PROMPT_CHARS = 4_000
_PDF_EXTENSION = ".pdf"


def _store() -> Any:
    return get_design_store()


def _require_document(design_id: str) -> JsonObject:
    document = _store().get_document(design_id)
    if document is None:
        raise NotFoundError(f"No existe el diseño: {design_id}")
    return cast("JsonObject", document)


def _document_from_params(params: JsonObject) -> JsonObject:
    raw = params.get("document")
    if isinstance(raw, dict) and raw:
        return models.normalize_document(raw)
    design_id = str(params.get("id") or "").strip()
    if not design_id:
        raise ValidationError("Se requiere 'document' o 'id'")
    return _require_document(design_id)


def _filename_for(document: JsonObject, output_path: str | None) -> str:
    stem = sanitizar_nombre(str(document.get("name") or "diseno")).strip() or "diseno"
    if output_path:
        candidate = sanitizar_nombre(output_path).strip()
        if candidate.lower().endswith(_PDF_EXTENSION):
            return candidate
        return f"{candidate}{_PDF_EXTENSION}"
    return f"{stem}{_PDF_EXTENSION}"


@with_locale
@validate_params()
def design_list(params: JsonObject) -> JsonObject:
    return {"designs": _store().list_documents()}


@with_locale
@validate_params("id")
def design_get(params: JsonObject) -> JsonObject:
    design_id = str(params.get("id") or "").strip()
    if not design_id:
        raise ValidationError("Falta 'id'")
    return {"document": _require_document(design_id)}


@with_locale
@validate_params()
def design_create_empty(params: JsonObject) -> JsonObject:
    name = params.get("name")
    document = _store().create_empty(name if isinstance(name, str) else None)
    return {"document": document}


@with_locale
@validate_params("id")
def design_delete(params: JsonObject) -> JsonObject:
    design_id = str(params.get("id") or "").strip()
    if not design_id:
        raise ValidationError("Falta 'id'")
    if not _store().delete_document(design_id):
        raise NotFoundError(f"No existe el diseño: {design_id}")
    return {"deleted": True, "id": design_id}


@with_locale
@validate_params("prompt", "provider")
def design_generate(params: JsonObject) -> JsonObject:
    provider = str(params.get("provider") or "").strip()
    if not provider:
        raise ValidationError("Falta 'provider'")
    prompt = params.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValidationError("Falta 'prompt'")
    if len(prompt) > MAX_PROMPT_CHARS:
        raise ValidationError(f"El prompt supera los {MAX_PROMPT_CHARS} caracteres")

    model = params.get("model")
    preset = params.get("page_preset")
    page_preset = preset.strip() if isinstance(preset, str) and preset.strip() in models.PAGE_PRESETS else None

    log_event(
        logger,
        logging.INFO,
        "design.generate.started",
        provider=provider,
        page_preset=page_preset or models.DEFAULT_PAGE_PRESET,
    )
    try:
        document = design_generate_module.generate_design(
            provider,
            prompt,
            model if isinstance(model, str) else None,
            page_preset=page_preset,
        )
    except design_generate_module.DesignGenerationError as exc:
        log_event(logger, logging.WARNING, "design.generate.failed", provider=provider, reason=str(exc)[:200])
        raise ValidationError(str(exc)) from exc

    document["id"] = _store().new_id()
    saved = _store().save_document(document)
    log_event(
        logger,
        logging.INFO,
        "design.generate.succeeded",
        design_id=saved["id"],
        slides=len(saved["slides"]),
        provider=provider,
    )
    return {"document": saved}


@with_locale
@validate_params()
def design_render_html(params: JsonObject) -> JsonObject:
    """HTML sanitizable para la vista previa; no escribe nada en disco."""
    document = _document_from_params(params)
    return {
        "html": render_html(document),
        "slideCount": len(document.get("slides") or []),
        "page": document.get("page"),
    }


@with_locale
@validate_params()
def design_export_pdf(params: JsonObject) -> JsonObject:
    """Imprime el Design. Sin `output_path` devuelve base64 para descarga."""
    document = _document_from_params(params)
    output_path = params.get("output_path")
    output_path = output_path.strip() if isinstance(output_path, str) and output_path.strip() else None

    render = render_html(document, notes=True) if params.get("notes") is True else render_html(document)
    pdf = write_pdf_sanitized(render)
    filename = _filename_for(document, output_path)

    if output_path is None:
        return {
            "pdf_base64": base64.b64encode(pdf).decode("ascii"),
            "filename": filename,
        }

    with atomic_output_file(output_path, extension=_PDF_EXTENSION, overwrite=bool(params.get("overwrite"))) as target:
        target.tmp_path.write_bytes(pdf)
        saved_path = str(target.destination)
    return {"filename": filename, "saved_path": saved_path}


@with_locale
@validate_params()
def design_preflight(params: JsonObject) -> JsonObject:
    document = _document_from_params(params)
    return run_preflight(document)


@with_locale
@validate_params()
def design_memory_get(params: JsonObject) -> JsonObject:
    return {"memory": get_design_memory().load()}


@with_locale
@validate_params("text")
def design_memory_add(params: JsonObject) -> JsonObject:
    memory = get_design_memory().add(str(params.get("text") or ""))
    return {"memory": memory, "noteCount": len(memory["notes"])}


@with_locale
@validate_params("id")
def design_memory_update(params: JsonObject) -> JsonObject:
    try:
        memory = get_design_memory().update(
            str(params.get("id") or ""), str(params.get("text") or "")
        )
    except LookupError as exc:
        raise NotFoundError(str(exc)) from exc
    return {"memory": memory}


@with_locale
@validate_params("id")
def design_memory_delete(params: JsonObject) -> JsonObject:
    try:
        memory = get_design_memory().delete(str(params.get("id") or ""))
    except LookupError as exc:
        raise NotFoundError(str(exc)) from exc
    return {"memory": memory}


@with_locale
@validate_params()
def design_memory_clear(params: JsonObject) -> JsonObject:
    return {"memory": get_design_memory().clear()}


HANDLERS = {
    "design_list": design_list,
    "design_get": design_get,
    "design_create_empty": design_create_empty,
    "design_delete": design_delete,
    "design_generate": design_generate,
    "design_render_html": design_render_html,
    "design_export_pdf": design_export_pdf,
    "design_preflight": design_preflight,
    "design_memory_get": design_memory_get,
    "design_memory_add": design_memory_add,
    "design_memory_update": design_memory_update,
    "design_memory_delete": design_memory_delete,
    "design_memory_clear": design_memory_clear,
}
