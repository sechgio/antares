"""Sellador PDF stamp handlers."""
from __future__ import annotations

import base64
import random
from pathlib import Path
from typing import Any

from backend.core.sellador import apply_sellador, distribute_stamp_pages
from backend.core.sellador_io import resolve_pdf_bytes, resolve_stamp_bytes
from backend.core.sellador_preview import inspect_pdf_path, render_pdf_page_preview
from backend.handlers.common import with_locale

_MAX_INLINE_PDF_BYTES = 8 * 1024 * 1024


def _parse_positive_int(value: Any, label: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        msg = f"{label} inválido"
        raise ValueError(msg) from exc
    if parsed <= 0:
        msg = f"{label} debe ser mayor a cero"
        raise ValueError(msg)
    return parsed


def _parse_float(value: Any, label: str, *, allow_zero: bool = False) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        msg = f"{label} inválido"
        raise ValueError(msg) from exc
    if allow_zero:
        if parsed < 0:
            msg = f"{label} no puede ser negativo"
            raise ValueError(msg)
    elif parsed <= 0:
        msg = f"{label} debe ser mayor a cero"
        raise ValueError(msg)
    return parsed


def _parse_stamp_placements(value: Any) -> list[dict[str, float | int]] | None:
    if value is None:
        return None
    if not isinstance(value, list) or not value:
        return None
    placements: list[dict[str, float | int]] = []
    for item in value:
        if not isinstance(item, dict):
            msg = "Ubicaciones de sellos inválidas"
            raise ValueError(msg)
        if "page_index" in item:
            page_index = int(item["page_index"])
        elif "page" in item:
            page_index = int(item["page"]) - 1
        else:
            msg = "Índice de página requerido en cada ubicación"
            raise ValueError(msg)
        placements.append({
            "page_index": page_index,
            "x": _parse_float(item.get("x", 0), "Posición X", allow_zero=True),
            "y": _parse_float(item.get("y", 0), "Posición Y", allow_zero=True),
            "width": _parse_float(item.get("width", 120), "Ancho del sello"),
            "height": _parse_float(item.get("height", 120), "Alto del sello"),
        })
    return placements


def _parse_seed(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        msg = "Semilla inválida"
        raise ValueError(msg) from exc


@with_locale
def sellador_inspect_pdf(params: dict[str, Any]) -> dict[str, Any]:
    pdf_path = str(params.get("pdf_path") or "").strip()
    if not pdf_path:
        msg = "Ruta del PDF requerida"
        raise ValueError(msg)
    return inspect_pdf_path(pdf_path)


@with_locale
def sellador_render_page(params: dict[str, Any]) -> dict[str, Any]:
    pdf_path = str(params.get("pdf_path") or "").strip()
    if not pdf_path:
        msg = "Ruta del PDF requerida"
        raise ValueError(msg)
    page_num = _parse_positive_int(params.get("page_num", 1), "Página")
    max_width = _parse_positive_int(params.get("max_width", 2800), "Ancho de vista previa")
    return render_pdf_page_preview(pdf_path, page_num, max_width=max_width)


@with_locale
def sellador_apply(params: dict[str, Any]) -> dict[str, Any]:
    pdf_bytes = resolve_pdf_bytes(params)
    stamp_bytes = resolve_stamp_bytes(params)
    stamp_count = _parse_positive_int(params.get("stamp_count"), "Cantidad de sellos")
    x = _parse_float(params.get("x", 50), "Posición X", allow_zero=True)
    y = _parse_float(params.get("y", 50), "Posición Y", allow_zero=True)
    width = _parse_float(params.get("width", 120), "Ancho del sello")
    height = _parse_float(params.get("height", 120), "Alto del sello")
    seed = _parse_seed(params.get("seed"))

    stamp_placements = _parse_stamp_placements(params.get("stamp_placements"))

    result_bytes, page_indices, effective_seed = apply_sellador(
        pdf_bytes,
        stamp_bytes,
        stamp_count,
        x,
        y,
        width,
        height,
        seed,
        stamp_placements=stamp_placements,
    )

    output_path = str(params.get("output_path") or "").strip()
    filename = str(params.get("filename") or "documento_sellado.pdf").strip() or "documento_sellado.pdf"
    if not filename.lower().endswith(".pdf"):
        filename += ".pdf"

    payload: dict[str, Any] = {
        "filename": filename,
        "stamp_count": len(page_indices),
        "stamped_pages": [page + 1 for page in sorted(page_indices)],
        "page_assignments": [page + 1 for page in page_indices],
        "seed": effective_seed,
    }

    if output_path:
        destination = Path(output_path).expanduser().resolve()
        if destination.suffix.lower() != ".pdf":
            destination = destination.with_suffix(".pdf")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(result_bytes)
        payload["saved_path"] = str(destination)
        payload["filename"] = destination.name
    elif len(result_bytes) > _MAX_INLINE_PDF_BYTES:
        msg = "El PDF generado es demasiado grande. Guárdalo con una ruta de salida."
        raise ValueError(msg)
    else:
        payload["pdf_base64"] = base64.b64encode(result_bytes).decode("ascii")

    return payload


@with_locale
def sellador_preview_pages(params: dict[str, Any]) -> dict[str, Any]:
    page_count = _parse_positive_int(params.get("page_count"), "Cantidad de páginas")
    stamp_count = _parse_positive_int(params.get("stamp_count"), "Cantidad de sellos")
    seed = _parse_seed(params.get("seed"))
    effective_seed = seed if seed is not None else random.randint(0, 2_147_483_647)
    page_indices, _ = distribute_stamp_pages(page_count, stamp_count, effective_seed)
    return {
        "page_assignments": [page + 1 for page in page_indices],
        "stamped_pages": [page + 1 for page in sorted(set(page_indices))],
        "seed": effective_seed,
    }


HANDLERS = {
    "sellador_inspect_pdf": sellador_inspect_pdf,
    "sellador_render_page": sellador_render_page,
    "sellador_apply": sellador_apply,
    "sellador_preview_pages": sellador_preview_pages,
}
