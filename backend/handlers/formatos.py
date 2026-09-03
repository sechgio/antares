from __future__ import annotations

import base64
import uuid
from pathlib import Path
from typing import Any

from backend.handlers.common import parse_positive_int, with_locale

_PDF_MAGIC = b"%PDF"
_MAX_PREVIEW_WIDTH = 2400


@with_locale
def formatos_list(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    from backend.core.formatos import list_formats
    return {"formats": list_formats()}

_MAX_INLINE_PDF_BYTES = 40 * 1024 * 1024


@with_locale
def formatos_generate(params: dict[str, Any]) -> dict[str, str]:
    from backend.core.formatos import generate_pdf
    from backend.utils.paths import user_data_path

    fmt_id = params.get("format_id", "")
    desde = parse_positive_int(params.get("desde", 1), "desde")
    hasta = parse_positive_int(params.get("hasta", 1), "hasta")
    pdf_bytes, filename = generate_pdf(fmt_id, desde, hasta)
    output_path = str(params.get("output_path") or "").strip()
    if output_path:
        resolved = str(params.get("_resolved_output_path") or output_path).strip()
        from backend.utils.validators import sanitizar_nombre as _snF
        safe = _snF(Path(resolved).name) or Path(resolved).name
        if not safe.lower().endswith(".pdf"):
            safe += ".pdf"
        destination = Path(resolved).parent / safe
        if destination.is_symlink() or destination.parent.is_symlink():
            raise ValueError("symlink no permitido en ruta de salida")
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            raise FileExistsError(f"El archivo ya existe: {destination}")
        tmp = destination.with_suffix(destination.suffix + ".tmp")
        tmp.write_bytes(pdf_bytes)
        import os as _osF
        _osF.replace(tmp, destination)
        return {"saved_path": str(destination), "filename": destination.name}

    if len(pdf_bytes) > _MAX_INLINE_PDF_BYTES:
        out_dir = user_data_path("formatos/out")
        out_dir.mkdir(parents=True, exist_ok=True)
        tmp_out = out_dir / f"{uuid.uuid4().hex[:12]}_{filename}"
        tmp_out.write_bytes(pdf_bytes)
        return {"saved_path": str(tmp_out), "filename": filename}

    return {"pdf_base64": base64.b64encode(pdf_bytes).decode("ascii"), "filename": filename}

@with_locale
def formatos_upload(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.formatos import add_uploaded_format
    content = base64.b64decode(params.get("content_b64", ""))
    if not content.startswith(_PDF_MAGIC):
        msg = "El archivo subido no es un PDF válido"
        raise ValueError(msg)
    entry = add_uploaded_format(
        params.get("nombre", ""), params.get("filename", ""),
        content, bool(params.get("persisted", True)), params.get("filename_pattern"),
    )
    result = dict(entry)
    result["has_mapping"] = result.get("mapping") is not None
    return {"format": result}

@with_locale
def formatos_delete(params: dict[str, Any]) -> dict[str, bool]:
    from backend.core.formatos import delete_format
    return {"deleted": delete_format(params.get("format_id", ""))}

@with_locale
def formatos_get_template(params: dict[str, Any]) -> dict[str, str]:
    from backend.core.formatos import get_template_pdf
    fmt_id = params.get("format_id", "")
    pdf_bytes, filename = get_template_pdf(fmt_id)
    return {"pdf_base64": base64.b64encode(pdf_bytes).decode("ascii"), "filename": filename}

@with_locale
def formatos_render_template_page(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.formatos import render_template_page
    fmt_id = params.get("format_id", "")
    page_num = parse_positive_int(params.get("page_num", 1), "page_num")
    max_width = parse_positive_int(params.get("max_width", 1200), "max_width", maximum=_MAX_PREVIEW_WIDTH)
    return render_template_page(fmt_id, page_num, max_width=max_width)

@with_locale
def formatos_update_mapping(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.formatos import update_mapping
    entry = update_mapping(params.get("format_id", ""), params.get("mapping", {}))
    if entry is None:
        msg = "Formato no encontrado"
        raise ValueError(msg)
    result = dict(entry)
    result["has_mapping"] = result.get("mapping") is not None
    return {"format": result}

HANDLERS = {
    "formatos_list": formatos_list,
    "formatos_generate": formatos_generate,
    "formatos_upload": formatos_upload,
    "formatos_delete": formatos_delete,
    "formatos_get_template": formatos_get_template,
    "formatos_render_template_page": formatos_render_template_page,
    "formatos_update_mapping": formatos_update_mapping,
}
