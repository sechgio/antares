from __future__ import annotations

from typing import Any

from backend.core.evidencia_volanteo import (
    MAX_PAGES,
    RenderingError,
    deserialize_document,
    render_docx,
    render_pdf,
    render_pdf_html,
)
from backend.handlers.common import finalize_render_export, validate_params, with_locale


@with_locale
@validate_params()
def evidencia_volanteo_render(params: dict[str, Any]) -> dict[str, Any]:
    fmt = str(params.get("format", "pdf")).lower()
    preview_html = str(params.get("html") or "").strip()

    document = deserialize_document(params)
    if len(document.pages) > MAX_PAGES:
        kind = "documento" if fmt == "docx" else "PDF"
        msg = f"El {kind} excede el máximo de {MAX_PAGES} páginas"
        raise RenderingError(msg)

    logos_raw = params.get("logos") or {}
    logos = {
        "left": logos_raw.get("left_b64") or None,
        "right": logos_raw.get("right_b64") or None,
    }
    images = {str(k): str(v) for k, v in (params.get("images") or {}).items() if v is not None}
    image_paths = {str(k): str(v) for k, v in (params.get("image_paths") or {}).items() if v is not None}

    if fmt == "docx":
        content, filename = render_docx(document, logos, images, image_paths)
        mime_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        fmt = "pdf"
        if preview_html:
            content, filename = render_pdf_html(preview_html)
        else:
            content, filename = render_pdf(document, logos, images, image_paths)
        mime_type = "application/pdf"
    return finalize_render_export(params, content, filename, fmt, mime_type)


HANDLERS = {
    "evidencia_volanteo_render": evidencia_volanteo_render,
}
