from __future__ import annotations

import io
import logging
import math
from pathlib import Path
from typing import Literal

from PIL import Image

_PREVIEW_MAX_WIDTH = 6144
_MAX_RENDER_PIXELS = 24_000_000
_MIN_PREVIEW_DPI = 220
_MAX_PREVIEW_DPI = 300
_PIL_PREVIEW_MODES = {1: "L", 3: "RGB"}
_PREVIEW_JPEG_QUALITY = 85
_PREVIEW_MIME = {"png": "image/png", "jpeg": "image/jpeg"}

PreviewFormat = Literal["png", "jpeg"]
logger = logging.getLogger(__name__)


def _require_fitz():
    try:
        import fitz
    except ImportError as exc:
        msg = "PyMuPDF no está instalado. Ejecuta: pip install pymupdf"
        raise ValueError(msg) from exc
    return fitz


def inspect_pdf_path(pdf_path: str) -> dict[str, float | int | str]:
    fitz = _require_fitz()
    path = Path(pdf_path).expanduser().resolve()
    with fitz.open(path) as doc:
        if doc.page_count == 0:
            msg = "El PDF no tiene páginas"
            raise ValueError(msg)
        rect = doc.load_page(0).rect
        return {
            "filename": path.name,
            "page_count": int(doc.page_count),
            "page_width": float(rect.width),
            "page_height": float(rect.height),
        }


def _resolve_preview_dpi(
    rect_width: float,
    rect_height: float,
    target_width: int,
    *,
    minimum_dpi: int = _MIN_PREVIEW_DPI,
    enforce_max_width: bool = False,
) -> int:
    if rect_width <= 0:
        return minimum_dpi
    dpi_from_width = 72.0 * target_width / rect_width
    dpi = max(float(minimum_dpi), min(dpi_from_width, float(_MAX_PREVIEW_DPI)))
    if enforce_max_width:
        dpi = min(dpi, dpi_from_width)
    if rect_height > 0:
        pixel_cap_dpi = 72.0 * math.sqrt(
            _MAX_RENDER_PIXELS / (rect_width * rect_height),
        )
        dpi = min(dpi, pixel_cap_dpi)

    candidate = math.floor(dpi)
    while candidate >= 1:
        pixel_width = math.ceil(rect_width * candidate / 72.0)
        pixel_height = (
            math.ceil(rect_height * candidate / 72.0)
            if rect_height > 0
            else 0
        )
        width_ok = not enforce_max_width or pixel_width <= target_width
        pixels_ok = (
            rect_height <= 0
            or pixel_width * pixel_height <= _MAX_RENDER_PIXELS
        )
        if width_ok and pixels_ok:
            return candidate
        candidate -= 1

    msg = "Las dimensiones de la página exceden los límites de preview"
    raise ValueError(msg)


def _pil_image_from_pixmap(pixmap) -> Image.Image | None:
    mode = _PIL_PREVIEW_MODES.get(int(pixmap.n))
    if mode is None or pixmap.alpha:
        return None
    return Image.frombytes(
        mode,
        (int(pixmap.width), int(pixmap.height)),
        pixmap.samples,
        "raw",
        mode,
        int(pixmap.stride),
        1,
    )


def _pixmap_to_preview_bytes(pixmap, image_format: PreviewFormat) -> tuple[bytes, str]:
    mime_type = _PREVIEW_MIME.get(image_format, _PREVIEW_MIME["png"])
    try:
        image = _pil_image_from_pixmap(pixmap)
        if image is not None:
            buffer = io.BytesIO()
            if image_format == "jpeg":
                image.save(buffer, format="JPEG", quality=_PREVIEW_JPEG_QUALITY, optimize=False)
            else:
                image.save(buffer, format="PNG", compress_level=1, optimize=False)
            return buffer.getvalue(), mime_type
    except Exception:
        logger.warning("PIL preview encode failed; falling back to MuPDF PNG", exc_info=True)
    return pixmap.tobytes("png"), "image/png"


def _render_doc_page(
    doc,
    page_num: int,
    max_width: int,
    *,
    minimum_dpi: int = _MIN_PREVIEW_DPI,
    enforce_max_width: bool = False,
    image_format: PreviewFormat = "png",
) -> dict[str, float | str]:
    import base64

    if page_num < 1 or page_num > doc.page_count:
        msg = f"Página {page_num} fuera de rango"
        raise ValueError(msg)
    page = doc.load_page(page_num - 1)
    rect = page.rect
    target_width = max(640, min(int(max_width), _PREVIEW_MAX_WIDTH))
    dpi = _resolve_preview_dpi(
        rect.width,
        rect.height,
        target_width,
        minimum_dpi=minimum_dpi,
        enforce_max_width=enforce_max_width,
    )
    pixmap = page.get_pixmap(dpi=dpi, alpha=False)
    payload, mime_type = _pixmap_to_preview_bytes(pixmap, image_format)

    return {
        "image_base64": base64.b64encode(payload).decode("ascii"),
        "page_width": float(rect.width),
        "page_height": float(rect.height),
        "rendered_width": float(pixmap.width),
        "rendered_height": float(pixmap.height),
        "render_dpi": float(dpi),
        "mime_type": mime_type,
    }


def render_pdf_page_preview(
    pdf_path: str,
    page_num: int,
    max_width: int = _PREVIEW_MAX_WIDTH,
    *,
    minimum_dpi: int = _MIN_PREVIEW_DPI,
    enforce_max_width: bool = False,
    image_format: PreviewFormat = "jpeg",
) -> dict[str, float | str]:
    fitz = _require_fitz()
    path = Path(pdf_path).expanduser().resolve()
    with fitz.open(path) as doc:
        return _render_doc_page(
            doc,
            page_num,
            max_width,
            minimum_dpi=minimum_dpi,
            enforce_max_width=enforce_max_width,
            image_format=image_format,
        )


def render_pdf_bytes_page_preview(
    pdf_bytes: bytes,
    page_num: int,
    max_width: int = _PREVIEW_MAX_WIDTH,
    *,
    minimum_dpi: int = _MIN_PREVIEW_DPI,
    enforce_max_width: bool = False,
    image_format: PreviewFormat = "png",
) -> dict[str, float | str]:
    fitz = _require_fitz()
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        return _render_doc_page(
            doc,
            page_num,
            max_width,
            minimum_dpi=minimum_dpi,
            enforce_max_width=enforce_max_width,
            image_format=image_format,
        )
