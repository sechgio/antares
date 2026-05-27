"""Formatos PDF handlers."""
from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

from backend.handlers.common import with_locale

_PDF_MAGIC = b"%PDF"


@with_locale
def formatos_list(params: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    from backend.core.formatos import list_formats
    return {"formats": list_formats()}

@with_locale
def formatos_generate(params: dict[str, Any]) -> dict[str, str]:
    from backend.core.formatos import generate_pdf
    fmt_id = params.get("format_id", "")
    desde = int(params.get("desde", 1))
    hasta = int(params.get("hasta", 1))
    pdf_bytes, filename = generate_pdf(fmt_id, desde, hasta)
    output_path = str(params.get("output_path") or "").strip()
    if output_path:
        destination = Path(output_path).expanduser().resolve()
        if destination.suffix.lower() != ".pdf":
            destination = destination.with_suffix(".pdf")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(pdf_bytes)
        return {"saved_path": str(destination), "filename": destination.name}
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
    "formatos_update_mapping": formatos_update_mapping,
}
