"""Rasterize PDF pages for sellador previews on large files."""
from __future__ import annotations

from pathlib import Path

from pypdf import PdfReader

_PREVIEW_MAX_WIDTH = 6144
_MAX_RENDER_PIXELS = 24_000_000
_MIN_PREVIEW_DPI = 220
_MAX_PREVIEW_DPI = 300


def inspect_pdf_path(pdf_path: str) -> dict[str, float | int | str]:
    path = Path(pdf_path).expanduser().resolve()
    reader = PdfReader(str(path))
    if len(reader.pages) == 0:
        msg = "El PDF no tiene páginas"
        raise ValueError(msg)
    page = reader.pages[0]
    mediabox = page.mediabox
    return {
        "filename": path.name,
        "page_count": len(reader.pages),
        "page_width": float(mediabox.width),
        "page_height": float(mediabox.height),
    }


def _resolve_preview_dpi(rect_width: float, rect_height: float, target_width: int) -> int:
    if rect_width <= 0:
        return _MIN_PREVIEW_DPI
    dpi_from_width = 72.0 * target_width / rect_width
    dpi = max(float(_MIN_PREVIEW_DPI), min(dpi_from_width, float(_MAX_PREVIEW_DPI)))
    if rect_height > 0:
        pixel_w = rect_width * dpi / 72.0
        pixel_h = rect_height * dpi / 72.0
        pixel_count = pixel_w * pixel_h
        if pixel_count > _MAX_RENDER_PIXELS:
            dpi = (72.0 * (_MAX_RENDER_PIXELS / (rect_width * rect_height))) ** 0.5
    return int(max(round(dpi), _MIN_PREVIEW_DPI))


def render_pdf_page_preview(
    pdf_path: str,
    page_num: int,
    max_width: int = _PREVIEW_MAX_WIDTH,
) -> dict[str, float | str]:
    try:
        import fitz  # type: ignore[import-untyped]  # pymupdf
    except ImportError as exc:
        msg = "PyMuPDF no está instalado. Ejecuta: pip install pymupdf"
        raise ValueError(msg) from exc

    import base64

    path = Path(pdf_path).expanduser().resolve()
    with fitz.open(path) as doc:
        if page_num < 1 or page_num > doc.page_count:
            msg = f"Página {page_num} fuera de rango"
            raise ValueError(msg)
        page = doc.load_page(page_num - 1)
        rect = page.rect
        target_width = max(640, min(int(max_width), _PREVIEW_MAX_WIDTH))
        dpi = _resolve_preview_dpi(rect.width, rect.height, target_width)
        pixmap = page.get_pixmap(dpi=dpi, alpha=False)
        png_bytes = pixmap.tobytes("png")

    return {
        "image_base64": base64.b64encode(png_bytes).decode("ascii"),
        "page_width": float(rect.width),
        "page_height": float(rect.height),
        "rendered_width": float(pixmap.width),
        "rendered_height": float(pixmap.height),
        "render_dpi": float(dpi),
        "mime_type": "image/png",
    }
