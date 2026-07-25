"""Read PDF/stamp inputs from disk for large-file sellador workflows."""
from __future__ import annotations

import base64
from pathlib import Path

_PDF_MAGIC = b"%PDF"
MAX_PDF_BYTES = 50 * 1024 * 1024
MAX_STAMP_BYTES = 10 * 1024 * 1024


def read_user_file(path_value: str, label: str, *, max_bytes: int) -> bytes:
    path = Path(path_value).expanduser().resolve()
    if not path.is_file():
        msg = f"{label} no encontrado"
        raise ValueError(msg)
    size = path.stat().st_size
    if size > max_bytes:
        limit_mb = max_bytes // (1024 * 1024)
        msg = f"{label} demasiado grande (máx. {limit_mb} MB)"
        raise ValueError(msg)
    return path.read_bytes()


def resolve_pdf_bytes(params: dict) -> bytes:
    pdf_path = str(params.get("pdf_path") or "").strip()
    if pdf_path:
        content = read_user_file(pdf_path, "PDF", max_bytes=MAX_PDF_BYTES)
        if not content.startswith(_PDF_MAGIC):
            msg = "El archivo no es un PDF válido"
            raise ValueError(msg)
        return content
    raw = str(params.get("pdf_b64") or "").strip()
    if not raw:
        msg = "PDF requerido (pdf_path o pdf_b64)"
        raise ValueError(msg)
    return base64.b64decode(raw, validate=True)


def resolve_stamp_bytes(params: dict) -> bytes:
    stamp_path = str(params.get("stamp_path") or "").strip()
    if stamp_path:
        return read_user_file(stamp_path, "Sello", max_bytes=MAX_STAMP_BYTES)
    raw = str(params.get("stamp_b64", "") or "")
    if not raw:
        msg = "Imagen de sello requerida"
        raise ValueError(msg)
    return base64.b64decode(raw, validate=True)
