"""Visual overlay strategy for PDF correlative number generation."""
from __future__ import annotations

import io
import re
from typing import Any

from pypdf import PdfReader, PdfWriter

from backend.core.format_strategies.shared import _escape_pdf_text


def _build_overlay_stamp_pdf(ll_x: float, ll_y: float, ur_x: float, ur_y: float, clean_name: str, overlay_stream: str) -> bytes:
    overlay_bytes = overlay_stream.encode("latin-1")
    objects = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        (f"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [{ll_x} {ll_y} {ur_x} {ur_y}] /Resources << /Font << /{clean_name} << /Type /Font /Subtype /Type1 /BaseFont /{clean_name} /Encoding /WinAnsiEncoding >> >> >> /Contents 4 0 R >>\nendobj\n").encode("latin-1"),
        b"4 0 obj\n<< /Length " + str(len(overlay_bytes)).encode("ascii") + b" >>\nstream\n" + overlay_bytes + b"endstream\nendobj\n",
    ]
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
    pdf += (f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF").encode("ascii")
    return pdf


def _append_rounded_rect_path(parts: list[str], x: float, y: float, width: float, height: float, radius: float) -> None:
    radius = max(0.0, min(radius, width / 2, height / 2))
    if radius == 0:
        parts.append(f"{x} {y} {width} {height} re")
        return
    k = radius * 0.5522847498
    right = x + width
    top = y + height
    parts.append(f"{x + radius} {y} m")
    parts.append(f"{right - radius} {y} l")
    parts.append(f"{right - radius + k} {y} {right} {y + radius - k} {right} {y + radius} c")
    parts.append(f"{right} {top - radius} l")
    parts.append(f"{right} {top - radius + k} {right - radius + k} {top} {right - radius} {top} c")
    parts.append(f"{x + radius} {top} l")
    parts.append(f"{x + radius - k} {top} {x} {top - radius + k} {x} {top - radius} c")
    parts.append(f"{x} {y + radius} l")
    parts.append(f"{x} {y + radius - k} {x + radius - k} {y} {x + radius} {y} c")
    parts.append("h")


def _blank_number_in_xobject(page, mcids: list[int]) -> None:
    xobjects = page["/Resources"].get("/XObject")
    if not xobjects:
        return
    for ref in xobjects.get_object().values():
        xobj = ref.get_object()
        if xobj.get("/Subtype") != "/Form":
            continue
        data = xobj.get_data()
        modified = False
        for mcid in mcids:
            marker_pat = re.compile(rb"MCID\s*" + str(mcid).encode() + rb"\s*>>\s*BDC")
            marker = marker_pat.search(data)
            if not marker:
                continue
            section_start = marker.end()
            next_mcid = re.search(rb"MCID\s+\d+", data[section_start + 4:])
            section_end = section_start + 4 + next_mcid.start() if next_mcid else min(section_start + max(len(data) // 10, 500), len(data))
            section = data[section_start:section_end]
            new_section = re.sub(rb"\([^\)]{1,4}\)\s*Tj", b"(\x00\x03) Tj", section)
            if new_section != section:
                data = data[:section_start] + new_section + data[section_end:]
                modified = True
        if modified:
            xobj.set_data(data)


def _apply_visual_overlay(page, number: int, mapping: dict[str, Any]) -> None:
    padded = str(number).zfill(mapping.get("padding", 7))
    escaped = _escape_pdf_text(padded)
    escaped_label = _escape_pdf_text("OT:")
    mediabox = page.mediabox
    ll_x, ll_y = float(mediabox.lower_left[0]), float(mediabox.lower_left[1])
    ur_x, ur_y = float(mediabox.upper_right[0]), float(mediabox.upper_right[1])
    pdf_y = ur_y - mapping["y"] - mapping["font_size"]
    clean_name = mapping["font_name"].replace("/", "")
    parts: list[str] = ["q"]
    bx, by, bw, bh = mapping.get("blank_x"), mapping.get("blank_y"), mapping.get("blank_width"), mapping.get("blank_height")
    has_blank = all(v is not None for v in (bx, by, bw, bh))
    if has_blank:
        blank_pdf_y = ur_y - by - bh
        parts.append("1 1 1 rg")
        parts.append(f"{bx} {blank_pdf_y} {bw} {bh} re")
        parts.append("f")
        if mapping.get("redraw_ot_badge"):
            radius = min(8.0, float(bh) / 2)
            parts.append(f"{mapping['color_r']} {mapping['color_g']} {mapping['color_b']} RG")
            parts.append("1 1 1 rg")
            parts.append("1.35 w")
            _append_rounded_rect_path(parts, float(bx), float(blank_pdf_y), float(bw), float(bh), radius)
            parts.append("B")
            parts.append(f"{mapping['color_r']} {mapping['color_g']} {mapping['color_b']} rg")
            parts.append("BT")
            parts.append(f"/{clean_name} {mapping['font_size']} Tf")
            parts.append(f"{float(bx) + 14} {pdf_y} Td")
            parts.append(f"({escaped_label}) Tj")
            parts.append("ET")
        elif mapping.get("redraw_top_border"):
            top_y = blank_pdf_y + bh
            right_x = bx + bw
            parts.append(f"{mapping['color_r']} {mapping['color_g']} {mapping['color_b']} RG")
            parts.append("1 w")
            parts.append(f"{bx} {top_y} m")
            parts.append(f"{right_x} {top_y} l")
            parts.append("S")
    parts.append(f"{mapping['color_r']} {mapping['color_g']} {mapping['color_b']} rg")
    parts.append("BT")
    parts.append(f"/{clean_name} {mapping['font_size']} Tf")
    parts.append(f"{mapping['x']} {pdf_y} Td")
    parts.append(f"({escaped}) Tj")
    parts.append("ET")
    parts.append("Q")
    overlay_stream = "\n".join(parts) + "\n"
    stamp_pdf = _build_overlay_stamp_pdf(ll_x, ll_y, ur_x, ur_y, clean_name, overlay_stream)
    stamp_reader = PdfReader(io.BytesIO(stamp_pdf))
    page.merge_page(stamp_reader.pages[0])


_DEFAULT_OVERLAY_MAPPING = {
    "page": 0, "x": 500, "y": 30, "width": 140, "height": 20,
    "font_size": 12, "font_name": "Helvetica-Bold",
    "color_r": 0, "color_g": 0, "color_b": 0,
    "padding": 7,
    "blank_x": None, "blank_y": None, "blank_width": None, "blank_height": None,
    "redraw_top_border": False, "redraw_ot_badge": False, "blank_mcids": None,
}


class VisualOverlayStrategy:
    def generate(self, template_bytes: bytes, desde: int, hasta: int, mapping: dict[str, Any] | None = None) -> bytes:
        if mapping is None:
            msg = "Visual overlay requires mapping configuration"
            raise ValueError(msg)
        writer = PdfWriter()
        for number in range(desde, hasta + 1):
            reader = PdfReader(io.BytesIO(template_bytes))
            target_page_idx = min(mapping.get("page", 0), len(reader.pages) - 1)
            page = reader.pages[target_page_idx]
            if mapping.get("blank_mcids"):
                _blank_number_in_xobject(page, mapping["blank_mcids"])
            _apply_visual_overlay(page, number, mapping)
            writer.add_page(page)
        buffer = io.BytesIO()
        writer.write(buffer)
        return buffer.getvalue()


class SimpleOverlayStrategy:
    def generate(self, template_bytes: bytes, desde: int, hasta: int, mapping: dict[str, Any] | None = None) -> bytes:
        writer = PdfWriter()
        for number in range(desde, hasta + 1):
            reader = PdfReader(io.BytesIO(template_bytes))
            target_page_idx = min(_DEFAULT_OVERLAY_MAPPING.get("page", 0), len(reader.pages) - 1)
            page = reader.pages[target_page_idx]
            _apply_visual_overlay(page, number, _DEFAULT_OVERLAY_MAPPING)
            writer.add_page(page)
        buffer = io.BytesIO()
        writer.write(buffer)
        return buffer.getvalue()
