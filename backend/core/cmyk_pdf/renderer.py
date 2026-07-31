"""Native PyMuPDF CMYK Vector PDF Renderer for Canvas Documents."""

from __future__ import annotations

import os
from typing import Any, cast

import fitz  # PyMuPDF
from PIL import Image

from backend.core.cmyk_pdf.color import convert_pil_to_cmyk_bytes, css_color_to_cmyk

MM_TO_PT = 72.0 / 25.4  # ~2.834645669 pt per mm



def _parse_length_pt(val_str: Any, default_mm: float = 0.0) -> float:
    """Parse CSS dimension string (e.g. '10mm', '100px', '2.5') to points."""
    if val_str is None:
        return default_mm * MM_TO_PT
    s = str(val_str).strip().lower()
    if s.endswith("mm"):
        try:
            return float(s[:-2]) * MM_TO_PT
        except ValueError:
            return default_mm * MM_TO_PT
    if s.endswith("px"):
        try:
            # Assume 96 DPI CSS pixels -> 72 DPI points: 1px = 0.75pt
            return float(s[:-2]) * 0.75
        except ValueError:
            return default_mm * MM_TO_PT
    if s.endswith("pt"):
        try:
            return float(s[:-2])
        except ValueError:
            return default_mm * MM_TO_PT
    try:
        # Fallback raw number -> treat as mm
        return float(s) * MM_TO_PT
    except ValueError:
        return default_mm * MM_TO_PT


def _resolve_template_value(val: str, ctx: dict[str, Any]) -> str:
    """Substitute {{field_key}} or field values from context."""
    if not val or "{{" not in val:
        return val
    out = val
    for key, item in ctx.get("values", {}).items():
        placeholder = f"{{{{{key}}}}}"
        if placeholder in out:
            out = out.replace(placeholder, str(item or ""))
    return out


class CanvasCmykRenderer:
    """Generates print-ready CMYK PDFs from Canvas documents using PyMuPDF."""

    def __init__(
        self,
        document: dict[str, Any],
        contexts: list[dict[str, Any]] | None = None,
        color_profile: str = "cmyk_iso_coated_v2",
        dpi: int = 300,
        bleed_mm: float = 0.0,
        show_crop_marks: bool = False,
    ) -> None:
        self.document = document
        self.contexts = contexts or [{}]
        self.color_profile = color_profile
        self.dpi = max(150, min(1200, dpi))
        self.bleed_mm = max(0.0, bleed_mm)
        self.show_crop_marks = show_crop_marks

        page_meta = document.get("page", {})
        self.page_w_mm = float(page_meta.get("widthMm", 210))
        self.page_h_mm = float(page_meta.get("heightMm", 297))

    def render(self, local_image_paths: dict[str, str] | None = None) -> bytes:
        local_image_paths = local_image_paths or {}
        pdf = fitz.open()

        bleed_pt = self.bleed_mm * MM_TO_PT
        trim_w_pt = self.page_w_mm * MM_TO_PT
        trim_h_pt = self.page_h_mm * MM_TO_PT

        # If crop marks are enabled, extend MediaBox beyond bleed by 10mm margin
        crop_margin_pt = (10.0 * MM_TO_PT) if self.show_crop_marks else 0.0
        media_w_pt = trim_w_pt + 2 * (bleed_pt + crop_margin_pt)
        media_h_pt = trim_h_pt + 2 * (bleed_pt + crop_margin_pt)

        origin_x_pt = bleed_pt + crop_margin_pt
        origin_y_pt = bleed_pt + crop_margin_pt

        pages = self.document.get("pages") or [{"id": "page-1"}]
        layers = self.document.get("layers") or []

        for ctx in self.contexts:
            for page_idx in range(len(pages)):
                page = pdf.new_page(width=media_w_pt, height=media_h_pt)
                media_rect = fitz.Rect(0, 0, media_w_pt, media_h_pt)
                page.set_mediabox(media_rect)

                # Set PDF geometry boxes (TrimBox & BleedBox)
                mbox = page.mediabox
                trim_rect = fitz.Rect(
                    max(mbox.x0, origin_x_pt),
                    max(mbox.y0, origin_y_pt),
                    min(mbox.x1, origin_x_pt + trim_w_pt),
                    min(mbox.y1, origin_y_pt + trim_h_pt),
                )
                bleed_rect = fitz.Rect(
                    max(mbox.x0, origin_x_pt - bleed_pt),
                    max(mbox.y0, origin_y_pt - bleed_pt),
                    min(mbox.x1, origin_x_pt + trim_w_pt + bleed_pt),
                    min(mbox.y1, origin_y_pt + trim_h_pt + bleed_pt),
                )
                page.set_trimbox(trim_rect)
                page.set_bleedbox(bleed_rect)

                if self.show_crop_marks and crop_margin_pt > 0:
                    self._draw_crop_marks(page, trim_rect, crop_margin_pt)

                # Render page layers
                page_layers = [
                    layer for layer in layers if layer.get("pageIndex", 0) == page_idx and layer.get("visible", True)
                ]
                shape = page.new_shape()

                for layer in page_layers:
                    self._render_layer(page, shape, layer, ctx, origin_x_pt, origin_y_pt, local_image_paths)

                shape.commit()

        pdf_bytes = cast(bytes, pdf.tobytes(clean=True, deflate=True))
        pdf.close()
        return pdf_bytes

    def _draw_crop_marks(self, page: fitz.Page, trim: fitz.Rect, margin_pt: float) -> None:
        """Draw prepress crop marks outside trim box."""
        shape = page.new_shape()
        mark_len = margin_pt * 0.6
        mark_offset = margin_pt * 0.2
        cmyk_black = (0.0, 0.0, 0.0, 1.0)  # 100% Key/Registration black

        # Top-Left
        shape.draw_line(
            fitz.Point(trim.x0 - mark_offset - mark_len, trim.y0),
            fitz.Point(trim.x0 - mark_offset, trim.y0),
        )
        shape.draw_line(
            fitz.Point(trim.x0, trim.y0 - mark_offset - mark_len),
            fitz.Point(trim.x0, trim.y0 - mark_offset),
        )

        # Top-Right
        shape.draw_line(
            fitz.Point(trim.x1 + mark_offset, trim.y0),
            fitz.Point(trim.x1 + mark_offset + mark_len, trim.y0),
        )
        shape.draw_line(
            fitz.Point(trim.x1, trim.y0 - mark_offset - mark_len),
            fitz.Point(trim.x1, trim.y0 - mark_offset),
        )

        # Bottom-Left
        shape.draw_line(
            fitz.Point(trim.x0 - mark_offset - mark_len, trim.y1),
            fitz.Point(trim.x0 - mark_offset, trim.y1),
        )
        shape.draw_line(
            fitz.Point(trim.x0, trim.y1 + mark_offset),
            fitz.Point(trim.x0, trim.y1 + mark_offset + mark_len),
        )

        # Bottom-Right
        shape.draw_line(
            fitz.Point(trim.x1 + mark_offset, trim.y1),
            fitz.Point(trim.x1 + mark_offset + mark_len, trim.y1),
        )
        shape.draw_line(
            fitz.Point(trim.x1, trim.y1 + mark_offset),
            fitz.Point(trim.x1, trim.y1 + mark_offset + mark_len),
        )

        shape.finish(color=cmyk_black, width=0.5)
        shape.commit()

    def _render_layer(
        self,
        page: fitz.Page,
        shape: fitz.Shape,
        layer: dict[str, Any],
        ctx: dict[str, Any],
        origin_x: float,
        origin_y: float,
        local_image_paths: dict[str, str],
    ) -> None:
        l_type = layer.get("type", "rect")
        css_vars = layer.get("cssVars") or {}

        x = origin_x + _parse_length_pt(css_vars.get("--translate-x"), 0)
        y = origin_y + _parse_length_pt(css_vars.get("--translate-y"), 0)
        w = _parse_length_pt(css_vars.get("--width"), 40)
        h = _parse_length_pt(css_vars.get("--height"), 10)

        bg_color_str = css_vars.get("--background-color") or css_vars.get("--fill")
        border_color_str = css_vars.get("--border-color") or css_vars.get("--stroke")
        border_width_pt = _parse_length_pt(css_vars.get("--border-width"), 0)

        bg_cmyk = css_color_to_cmyk(bg_color_str) if bg_color_str and bg_color_str != "transparent" else None
        border_cmyk = css_color_to_cmyk(border_color_str) if border_color_str and border_width_pt > 0 else None

        rect = fitz.Rect(x, y, x + w, y + h)

        if l_type in ("rect", "frame"):
            shape.draw_rect(rect)
            if bg_cmyk or border_cmyk:
                shape.finish(
                    color=border_cmyk,
                    fill=bg_cmyk,
                    width=border_width_pt or 1.0,
                )

        elif l_type == "ellipse":
            shape.draw_oval(rect)
            if bg_cmyk or border_cmyk:
                shape.finish(
                    color=border_cmyk,
                    fill=bg_cmyk,
                    width=border_width_pt or 1.0,
                )

        elif l_type in ("line", "arrow"):
            # Horizontal or diagonal line within rect bounds
            # (path-edited lines with meta.path are not expanded yet — midline fallback).
            p1 = fitz.Point(x, y + h / 2)
            p2 = fitz.Point(x + w, y + h / 2)
            shape.draw_line(p1, p2)
            stroke_cmyk = border_cmyk or (0.0, 0.0, 0.0, 1.0)
            shape.finish(color=stroke_cmyk, width=max(1.0, border_width_pt))

        elif l_type in ("text", "field"):
            raw_val = str(layer.get("value") or "")
            text_val = _resolve_template_value(raw_val, ctx)

            if bg_cmyk or border_cmyk:
                shape.draw_rect(rect)
                shape.finish(
                    color=border_cmyk,
                    fill=bg_cmyk,
                    width=border_width_pt,
                )

            color_str = css_vars.get("--color") or css_vars.get("color") or "#000000"
            text_cmyk = css_color_to_cmyk(color_str)
            font_size_pt = _parse_length_pt(css_vars.get("--font-size"), 4)  # default font size
            font_size_pt = max(6.0, font_size_pt)

            # Insert text in PyMuPDF with CMYK fill color
            page.insert_textbox(
                rect,
                text_val,
                fontsize=font_size_pt,
                fontname="helv",
                fill=text_cmyk,
            )

        elif l_type in ("image", "logo", "imageSlot"):
            # Resolve image source
            raw_val = str(layer.get("value") or "")
            resolved_src = _resolve_template_value(raw_val, ctx)

            img_path = local_image_paths.get(resolved_src) or resolved_src
            if os.path.exists(img_path):
                try:
                    with Image.open(img_path) as pil_img:
                        cmyk_bytes = convert_pil_to_cmyk_bytes(pil_img, dpi=self.dpi)
                        page.insert_image(rect, stream=cmyk_bytes)
                except Exception:
                    # Render placeholder if image fails to load
                    shape.draw_rect(rect)
                    shape.finish(color=(0, 0, 0, 0.5))

        elif l_type == "group":
            # Children are separate layers; the group frame is chrome-only.
            return

        else:
            # Clipped shapes / table / grid / checkbox / signature: bbox fallback
            # so print never silently drops them. Full fidelity remains RGB HTML.
            if bg_cmyk or border_cmyk:
                shape.draw_rect(rect)
                shape.finish(
                    color=border_cmyk,
                    fill=bg_cmyk,
                    width=border_width_pt or 1.0,
                )
            else:
                shape.draw_rect(rect)
                shape.finish(color=(0.0, 0.0, 0.0, 0.35), width=0.5)