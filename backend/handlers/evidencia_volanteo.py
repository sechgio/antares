from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

from backend.core.evidencia_volanteo import (
    MAX_PAGES,
    RenderingError,
    deserialize_document,
    render_docx,
    render_pdf,
    render_pdf_html,
)
from backend.handlers.common import validate_params, with_locale


@with_locale
@validate_params()
def evidencia_volanteo_render(params: dict[str, Any]) -> dict[str, Any]:
    fmt = str(params.get("format", "pdf")).lower()
    output_path = str(params.get("output_path") or "").strip() or None
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
        docx_bytes, filename = render_docx(document, logos, images, image_paths)
        if output_path:
            resolved = params.get("_resolved_output_path") or output_path
            from backend.utils.validators import sanitizar_nombre
            safe = sanitizar_nombre(Path(resolved).name) or Path(resolved).name
            if not safe.lower().endswith(".docx"):
                safe += ".docx"
            out = Path(resolved).parent / safe
            if out.is_symlink() or out.parent.is_symlink():
                raise ValueError("symlink no permitido en ruta de salida")
            if params.get("_write_token") and Path(resolved) != out:
                out = Path(resolved)
            out.parent.mkdir(parents=True, exist_ok=True)
            if out.exists():
                raise FileExistsError(f"El archivo ya existe: {out}")
            real_parent = Path(str(out.parent.resolve()))
            if real_parent != Path(str(Path(resolved).parent.resolve())) and out.parent.resolve() != Path(resolved).parent.resolve():
                raise ValueError("ruta de salida fuera de la raíz autorizada")
            tmp = out.with_suffix(out.suffix + ".tmp")
            tmp.write_bytes(docx_bytes)
            import os as _os
            _os.replace(tmp, out)
            return {
                "pdf_base64": "",
                "content_base64": "",
                "saved_path": str(out),
                "filename": out.name,
                "format": "docx",
                "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            }
        encoded = base64.b64encode(docx_bytes).decode("ascii")
        return {
            "pdf_base64": encoded,
            "content_base64": encoded,
            "filename": filename,
            "format": "docx",
            "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }

    if preview_html:
        pdf_bytes, filename = render_pdf_html(preview_html)
    else:
        pdf_bytes, filename = render_pdf(document, logos, images, image_paths)
    if output_path:
        resolved = params.get("_resolved_output_path") or output_path
        from backend.utils.validators import sanitizar_nombre as _sn
        safe = _sn(Path(resolved).name) or Path(resolved).name
        if not safe.lower().endswith(".pdf"):
            safe += ".pdf"
        out = Path(resolved).parent / safe
        if out.is_symlink() or out.parent.is_symlink():
            raise ValueError("symlink no permitido en ruta de salida")
        if params.get("_write_token") and Path(resolved) != out:
            out = Path(resolved)
        out.parent.mkdir(parents=True, exist_ok=True)
        if out.exists():
            raise FileExistsError(f"El archivo ya existe: {out}")
        tmp = out.with_suffix(out.suffix + ".tmp")
        tmp.write_bytes(pdf_bytes)
        import os as _os2
        _os2.replace(tmp, out)
        return {
            "pdf_base64": "",
            "content_base64": "",
            "saved_path": str(out),
            "filename": out.name,
            "format": "pdf",
            "mime_type": "application/pdf",
        }
    encoded = base64.b64encode(pdf_bytes).decode("ascii")
    return {
        "pdf_base64": encoded,
        "content_base64": encoded,
        "filename": filename,
        "format": "pdf",
        "mime_type": "application/pdf",
    }


HANDLERS = {
    "evidencia_volanteo_render": evidencia_volanteo_render,
}
