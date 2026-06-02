"""Apply image stamps to PDF pages with non-uniform random distribution."""
from __future__ import annotations

import io
import random
import zlib
from typing import Any

from PIL import Image
from pypdf import PdfReader, PdfWriter, Transformation

STAMP_EXPORT_DPI = 300.0


def _lcg_next(state: int) -> int:
    return (1664525 * state + 1013904223) & 0xFFFFFFFF


def effective_stamp_count(num_pages: int, stamp_count: int) -> int:
    if num_pages <= 0 or stamp_count <= 0:
        return 0
    return min(stamp_count, num_pages)


def distribute_stamp_pages(num_pages: int, stamp_count: int, seed: int | None = None) -> tuple[list[int], int]:
    """Return distinct 0-based page indices — at most one stamp per page."""
    count = effective_stamp_count(num_pages, stamp_count)
    if count <= 0:
        effective_seed = seed if seed is not None else 0
        return [], effective_seed
    effective_seed = seed if seed is not None else random.randint(0, 2_147_483_647)
    indices = list(range(num_pages))
    state = effective_seed & 0xFFFFFFFF
    for i in range(num_pages - 1, 0, -1):
        state = _lcg_next(state)
        j = state % (i + 1)
        indices[i], indices[j] = indices[j], indices[i]
    return indices[:count], effective_seed


def _validate_unique_stamp_pages(page_indices: list[int]) -> None:
    if len(page_indices) != len(set(page_indices)):
        msg = "Solo se permite un sello por página"
        raise ValueError(msg)


def group_stamp_pages(page_indices: list[int]) -> dict[int, int]:
    counts: dict[int, int] = {}
    for page_idx in page_indices:
        counts[page_idx] = counts.get(page_idx, 0) + 1
    return counts


def _prepare_stamp_image(stamp_bytes: bytes, width_pt: float, height_pt: float) -> tuple[Image.Image, float, float]:
    img = Image.open(io.BytesIO(stamp_bytes))
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")

    orig_w, orig_h = img.size
    target_px_w = max(1, round(width_pt * STAMP_EXPORT_DPI / 72.0))
    target_px_h = max(1, round(height_pt * STAMP_EXPORT_DPI / 72.0))
    scale = min(target_px_w / orig_w, target_px_h / orig_h, 1.0)
    new_w = max(1, round(orig_w * scale))
    new_h = max(1, round(orig_h * scale))

    if (new_w, new_h) != (orig_w, orig_h):
        img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)

    actual_w_pt = new_w * 72.0 / STAMP_EXPORT_DPI
    actual_h_pt = new_h * 72.0 / STAMP_EXPORT_DPI
    return img, actual_w_pt, actual_h_pt


def _pdf_object(body: bytes, obj_id: int) -> bytes:
    return f"{obj_id} 0 obj\n".encode("ascii") + body + b"\nendobj\n"


def _build_png_overlay_pdf(img: Image.Image, dpi: float = STAMP_EXPORT_DPI) -> bytes:
    if img.mode != "RGBA":
        img = img.convert("RGBA")

    width_px, height_px = img.size
    width_pt = width_px * 72.0 / dpi
    height_pt = height_px * 72.0 / dpi

    rgb = img.convert("RGB")
    alpha = img.split()[3]
    rgb_bytes = rgb.tobytes()
    alpha_bytes = alpha.tobytes()
    rgb_stream = zlib.compress(rgb_bytes, level=1)
    alpha_stream = zlib.compress(alpha_bytes, level=1)

    objects: list[bytes] = []
    objects.append(_pdf_object(b"<< /Type /Catalog /Pages 2 0 R >>", 1))
    objects.append(_pdf_object(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>", 2))
    page_body = (
        f"<< /Type /Page /Parent 2 0 R "
        f"/MediaBox [0 0 {width_pt:.4f} {height_pt:.4f}] "
        f"/Resources << /XObject << /Im1 4 0 R >> >> "
        f"/Contents 7 0 R >>"
    )
    objects.append(_pdf_object(page_body.encode("ascii"), 3))

    rgb_obj = (
        f"<< /Type /XObject /Subtype /Image /Width {width_px} /Height {height_px} "
        f"/ColorSpace /DeviceRGB /BitsPerComponent 8 "
        f"/Filter /FlateDecode /Length {len(rgb_stream)} "
        f"/SMask 5 0 R >>"
    )
    objects.append(_pdf_object(rgb_obj.encode("ascii") + b"stream\n" + rgb_stream + b"\nendstream", 4))

    alpha_obj = (
        f"<< /Type /XObject /Subtype /Image /Width {width_px} /Height {height_px} "
        f"/ColorSpace /DeviceGray /BitsPerComponent 8 "
        f"/Filter /FlateDecode /Length {len(alpha_stream)} >>"
    )
    objects.append(_pdf_object(alpha_obj.encode("ascii") + b"stream\n" + alpha_stream + b"\nendstream", 5))

    content = f"q {width_pt:.4f} 0 0 {height_pt:.4f} 0 0 cm /Im1 Do Q\n".encode("ascii")
    objects.append(_pdf_object(f"<< /Length {len(content)} >>\nstream\n".encode("ascii") + content + b"endstream", 7))

    pdf = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    offsets: list[int] = []
    for obj in objects:
        offsets.append(len(pdf))
        pdf += obj

    xref_offset = len(pdf)
    pdf += f"xref\n0 {len(objects) + 1}\n".encode("ascii")
    pdf += b"0000000000 65535 f \n"
    for offset in offsets:
        pdf += f"{offset:010d} 00000 n \n".encode("ascii")
    pdf += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF".encode("ascii")
    return pdf


def _stamp_image_to_pdf_page(img: Image.Image) -> bytes:
    if img.mode == "RGBA":
        return _build_png_overlay_pdf(img, STAMP_EXPORT_DPI)
    buffer = io.BytesIO()
    img.save(buffer, format="PDF", resolution=STAMP_EXPORT_DPI)
    return buffer.getvalue()


def _apply_stamp_to_page(page: Any, stamp_page: Any, x: float, y: float, stamp_height_pt: float) -> None:
    page_height = float(page.mediabox.height)
    pdf_y = page_height - y - stamp_height_pt
    transform = Transformation().translate(tx=x, ty=pdf_y)
    page.merge_transformed_page(stamp_page, transform)


def _apply_stamp_placements(
    reader: PdfReader,
    stamp_bytes: bytes,
    stamp_placements: list[dict[str, float | int]],
) -> None:
    """Apply stamps using per-stamp page index and geometry (0-based page_index)."""
    by_page: dict[int, list[dict[str, float | int]]] = {}
    for placement in stamp_placements:
        page_idx = int(placement["page_index"])
        if page_idx < 0 or page_idx >= len(reader.pages):
            msg = f"Página {page_idx + 1} fuera de rango"
            raise ValueError(msg)
        by_page.setdefault(page_idx, []).append(placement)

    for page_idx, page in enumerate(reader.pages):
        for placement in by_page.get(page_idx, ()):
            width = float(placement["width"])
            height = float(placement["height"])
            stamp_img, _actual_w_pt, actual_h_pt = _prepare_stamp_image(stamp_bytes, width, height)
            stamp_pdf_bytes = _stamp_image_to_pdf_page(stamp_img)
            stamp_page = PdfReader(io.BytesIO(stamp_pdf_bytes)).pages[0]
            _apply_stamp_to_page(
                page,
                stamp_page,
                float(placement["x"]),
                float(placement["y"]),
                actual_h_pt,
            )


def apply_sellador(
    pdf_bytes: bytes,
    stamp_bytes: bytes,
    stamp_count: int,
    x: float,
    y: float,
    width: float,
    height: float,
    seed: int | None = None,
    stamp_placements: list[dict[str, float | int]] | None = None,
) -> tuple[bytes, list[int], int | None]:
    if not pdf_bytes:
        msg = "PDF vacío"
        raise ValueError(msg)
    if not stamp_bytes:
        msg = "Imagen de sello requerida"
        raise ValueError(msg)
    if stamp_count <= 0:
        msg = "Debe indicar al menos un sello"
        raise ValueError(msg)
    if width <= 0 or height <= 0:
        msg = "El tamaño del sello debe ser mayor a cero"
        raise ValueError(msg)

    reader = PdfReader(io.BytesIO(pdf_bytes))
    num_pages = len(reader.pages)
    if num_pages == 0:
        msg = "El PDF no tiene páginas"
        raise ValueError(msg)

    effective_seed = seed if seed is not None else random.randint(0, 2_147_483_647)
    expected_count = effective_stamp_count(num_pages, stamp_count)

    writer = PdfWriter()
    if stamp_placements:
        if len(stamp_placements) != expected_count:
            msg = "La cantidad de ubicaciones debe coincidir con los sellos a aplicar"
            raise ValueError(msg)
        page_indices = [int(item["page_index"]) for item in stamp_placements]
        _validate_unique_stamp_pages(page_indices)
        _apply_stamp_placements(reader, stamp_bytes, stamp_placements)
        for page in reader.pages:
            writer.add_page(page)
    else:
        page_indices, effective_seed = distribute_stamp_pages(num_pages, stamp_count, effective_seed)
        page_counts = group_stamp_pages(page_indices)
        stamp_img, _actual_w_pt, actual_h_pt = _prepare_stamp_image(stamp_bytes, width, height)
        stamp_pdf_bytes = _stamp_image_to_pdf_page(stamp_img)
        stamp_page = PdfReader(io.BytesIO(stamp_pdf_bytes)).pages[0]
        for page_idx, page in enumerate(reader.pages):
            stamps_on_page = page_counts.get(page_idx, 0)
            for _ in range(stamps_on_page):
                _apply_stamp_to_page(page, stamp_page, x, y, actual_h_pt)
            writer.add_page(page)

    output = io.BytesIO()
    writer.write(output)
    return output.getvalue(), page_indices, effective_seed
