
from __future__ import annotations

import base64
import io
import json
import logging
import math
import os
import re
from collections import OrderedDict
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, cast

import pymupdf as fitz
from PIL import Image, ImageOps

from backend.core.cmyk_pdf.color import convert_pil_to_cmyk_bytes, css_color_to_cmyk
from backend.core.image_limits import apply_default_pixels_limit
from backend.utils.paths import user_data_path

apply_default_pixels_limit()

logger = logging.getLogger(__name__)

MM_TO_PT = 72.0 / 25.4
_CANVAS_ASSET_RE = re.compile(r"^canvas-asset:([a-fA-F0-9]{32,128})$")
_DATA_URL_RE = re.compile(r"^data:([^;,]+)?(;base64)?,(.*)$", re.DOTALL)
_CANVAS_MANIFEST_FILENAME = "antares-canvas-manifest.json"
_MAX_CANVAS_MANIFEST_BYTES = 2 * 1024 * 1024
_MAX_CANVAS_MANIFEST_B64_CHARS = ((_MAX_CANVAS_MANIFEST_BYTES + 2) // 3) * 4
_MAX_PREPARED_IMAGE_PIXELS = 40_000_000
_IMAGE_CACHE_MAX_BYTES = 64 * 1024 * 1024

_FONT_MAP: dict[str, str] = {
    "sans-serif": "helv",
    "arial": "helv",
    "helvetica": "helv",
    "open sans": "helv",
    "inter": "helv",
    "serif": "tiro",
    "times": "tiro",
    "georgia": "tiro",
    "times new roman": "tiro",
    "monospace": "cour",
    "courier": "cour",
    "consolas": "cour",
}

_TEXT_ALIGN: dict[str, int] = {
    "left": fitz.TEXT_ALIGN_LEFT,
    "center": fitz.TEXT_ALIGN_CENTER,
    "right": fitz.TEXT_ALIGN_RIGHT,
    "justify": fitz.TEXT_ALIGN_JUSTIFY,
}


def _decode_canvas_manifest(value: Any) -> bytes | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError("canvas_manifest_b64 must be a base64 string")
    if len(value) > _MAX_CANVAS_MANIFEST_B64_CHARS:
        raise ValueError("Canvas manifest exceeds the 2 MiB limit")
    try:
        raw = base64.b64decode(value, validate=True)
    except Exception as exc:
        raise ValueError("canvas_manifest_b64 is not valid base64") from exc
    if not raw or len(raw) > _MAX_CANVAS_MANIFEST_BYTES:
        raise ValueError("Canvas manifest exceeds the 2 MiB limit")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise ValueError("Canvas manifest is not valid UTF-8 JSON") from exc
    if (
        not isinstance(payload, dict)
        or payload.get("schema") != "antares.canvas.pdf"
        or payload.get("version") != 1
        or not isinstance(payload.get("document"), dict)
    ):
        raise ValueError("Canvas manifest schema is invalid")
    return raw


def _parse_rotate_deg(css_vars: dict[str, Any]) -> float:
    raw = css_vars.get("--rotate") or "0deg"
    s = str(raw).strip().lower().removesuffix("deg").strip()
    try:
        return float(s)
    except ValueError:
        return 0.0


def _rotate_point(x: float, y: float, cx: float, cy: float, deg: float) -> tuple[float, float]:
    if deg == 0:
        return x, y
    rad = math.radians(deg)
    cos_a = math.cos(rad)
    sin_a = math.sin(rad)
    dx, dy = x - cx, y - cy
    return cx + dx * cos_a - dy * sin_a, cy + dx * sin_a + dy * cos_a


def _rotated_polygon(rect: fitz.Rect, deg: float) -> list[fitz.Point]:
    cx = (rect.x0 + rect.x1) / 2
    cy = (rect.y0 + rect.y1) / 2
    corners = [
        (rect.x0, rect.y0),
        (rect.x1, rect.y0),
        (rect.x1, rect.y1),
        (rect.x0, rect.y1),
    ]
    return [fitz.Point(*_rotate_point(x, y, cx, cy, deg)) for x, y in corners]


def _map_font_family(family: Any) -> str:
    key = str(family or "").strip().lower().strip('"').strip("'")
    return _FONT_MAP.get(key, "helv")


def _text_align(css_vars: dict[str, Any]) -> int:
    align = str(css_vars.get("--text-align") or "left").strip().lower()
    return cast(int, _TEXT_ALIGN.get(align, fitz.TEXT_ALIGN_LEFT))


def _prepare_image_bytes(
    pil_img: Image.Image,
    fit: str,
    w_px: int,
    h_px: int,
    dpi: int,
) -> tuple[bytes, int, int]:
    resample = Image.Resampling.LANCZOS
    if fit == "cover":
        processed = ImageOps.fit(pil_img, (w_px, h_px), method=resample)
    elif fit == "contain":
        processed = ImageOps.contain(pil_img, (w_px, h_px), method=resample)
    else:
        processed = pil_img.resize((w_px, h_px), resample)
    return convert_pil_to_cmyk_bytes(processed, dpi=dpi), processed.width, processed.height


def _canvas_asset_path(asset_id: str) -> str:
    return str(user_data_path("canvas/assets") / asset_id)


def _resolve_image_path(src: str, local_image_paths: dict[str, str]) -> str:
    mapped = local_image_paths.get(src) or src
    match = _CANVAS_ASSET_RE.match(mapped)
    if match:
        return _canvas_asset_path(match.group(1))
    return mapped


@contextmanager
def _open_export_image(src: str, local_image_paths: dict[str, str]) -> Iterator[Image.Image | None]:
    mapped = local_image_paths.get(src) or src
    if not mapped:
        yield None
        return

    data_match = _DATA_URL_RE.match(mapped)
    if data_match:
        payload = data_match.group(3) or ""
        try:
            raw = base64.b64decode(payload) if data_match.group(2) else payload.encode("utf-8")
            with Image.open(io.BytesIO(raw)) as pil_img:
                yield pil_img
        except Exception:
            logger.debug("CMYK: failed to decode data: image", exc_info=True)
            yield None
        return

    path = _resolve_image_path(src, local_image_paths)
    if not path or not os.path.exists(path):
        yield None
        return
    if not _CANVAS_ASSET_RE.match(mapped) and path not in local_image_paths.values():
        logger.debug("CMYK: refusing non-authorized image path %s", path)
        yield None
        return
    try:
        with Image.open(path) as pil_img:
            yield pil_img
    except Exception:
        logger.debug("CMYK: failed to open image %s", path, exc_info=True)
        yield None


def _draw_shape_rect(
    shape: fitz.Shape,
    rect: fitz.Rect,
    rotate_deg: float,
    *,
    bg_cmyk: tuple[float, float, float, float] | None,
    border_cmyk: tuple[float, float, float, float] | None,
    border_width_pt: float,
) -> None:
    if rotate_deg:
        poly = _rotated_polygon(rect, rotate_deg)
        shape.draw_quad(fitz.Quad(poly[0], poly[1], poly[2], poly[3]))
    else:
        shape.draw_rect(rect)
    if bg_cmyk or border_cmyk:
        shape.finish(
            color=border_cmyk,
            fill=bg_cmyk,
            width=border_width_pt or 1.0,
        )


def _parse_length_pt(val_str: Any, default_mm: float = 0.0) -> float:
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
            return float(s[:-2]) * 0.75
        except ValueError:
            return default_mm * MM_TO_PT
    if s.endswith("pt"):
        try:
            return float(s[:-2])
        except ValueError:
            return default_mm * MM_TO_PT
    try:
        return float(s) * MM_TO_PT
    except ValueError:
        return default_mm * MM_TO_PT


def _resolve_template_value(val: str, ctx: dict[str, Any]) -> str:
    if not val or "{{" not in val:
        return val
    out = val
    values = ctx.get("values") or {}
    data = ctx.get("data") or {}
    merged: dict[str, Any] = {**data, **values}
    for key, item in merged.items():
        placeholder = f"{{{{{key}}}}}"
        if placeholder in out:
            out = out.replace(placeholder, str(item or ""))
    return out


def _resolve_image_src(layer: dict[str, Any], ctx: dict[str, Any]) -> str:
    meta = layer.get("meta") or {}
    l_type = layer.get("type", "")

    if l_type == "logo":
        side = meta.get("side")
        if side == "right":
            return str(ctx.get("logoRight") or "")
        return str(ctx.get("logoLeft") or "")

    if "index" in meta:
        try:
            index = int(meta["index"])
        except (TypeError, ValueError):
            index = -1
        if index >= 0:
            images = ctx.get("images") or []
            try:
                return str(images[index] or "")
            except IndexError:
                return ""

    return str(layer.get("value") or "")


@dataclass(frozen=True)
class _LayerPaint:
    rect: fitz.Rect
    x: float
    y: float
    w: float
    h: float
    rotate_deg: float
    bg_cmyk: tuple[float, float, float, float] | None
    border_cmyk: tuple[float, float, float, float] | None
    border_width_pt: float


@dataclass(frozen=True)
class _LayerRenderCall:
    page: fitz.Page
    shape: fitz.Shape
    layer: dict[str, Any]  # allowlist: dict[str, Any]
    ctx: dict[str, Any]  # allowlist: dict[str, Any]
    css_vars: dict[str, Any]  # allowlist: dict[str, Any]
    paint: _LayerPaint
    local_image_paths: dict[str, str]


class CanvasCmykRenderer:

    def _prepare_image_for_rect_cached(
        self,
        src: str,
        local_image_paths: dict[str, str],
        rect: fitz.Rect,
        object_fit: Any,
    ) -> tuple[bytes, fitz.Rect] | None:
        fit = str(object_fit or "fill").strip().lower()
        w_pt, h_pt = rect.width, rect.height
        w_px = max(1, int(w_pt * self.dpi / 72))
        h_px = max(1, int(h_pt * self.dpi / 72))
        if w_px * h_px > _MAX_PREPARED_IMAGE_PIXELS:
            raise ValueError("La imagen CMYK excede el límite de píxeles de preparación")
        src_key = _resolve_image_path(src, local_image_paths) or src
        key = (src_key, fit, w_px, h_px, self.dpi)

        cached = self._image_cache.get(key)
        if cached is None:
            with _open_export_image(src, local_image_paths) as pil_img:
                if pil_img is None:
                    return None
                cached = _prepare_image_bytes(pil_img, fit, w_px, h_px, self.dpi)
            entry_bytes = len(cached[0])
            if entry_bytes <= self._image_cache_max_bytes:
                self._image_cache[key] = cached
                self._image_cache_bytes += entry_bytes
                self._image_cache.move_to_end(key)
                while (
                    len(self._image_cache) > self._image_cache_max
                    or self._image_cache_bytes > self._image_cache_max_bytes
                ):
                    _, evicted = self._image_cache.popitem(last=False)
                    self._image_cache_bytes -= len(evicted[0])

        cmyk_bytes, cw, ch = cached
        if fit == "contain":
            sub_w_pt = cw * 72.0 / self.dpi
            sub_h_pt = ch * 72.0 / self.dpi
            sub_x0 = rect.x0 + (w_pt - sub_w_pt) / 2
            sub_y0 = rect.y0 + (h_pt - sub_h_pt) / 2
            insert_rect = fitz.Rect(sub_x0, sub_y0, sub_x0 + sub_w_pt, sub_y0 + sub_h_pt)
        else:
            insert_rect = rect
        return cmyk_bytes, insert_rect

    def __init__(
        self,
        document: dict[str, Any],
        contexts: list[dict[str, Any]] | None = None,
        color_profile: str = "cmyk_iso_coated_v2",
        dpi: int = 300,
        bleed_mm: float = 0.0,
        show_crop_marks: bool = False,
        pair_context_pages: bool = False,
        canvas_manifest_b64: str | None = None,
    ) -> None:
        self.document = document
        self.contexts = contexts or [{}]
        self.color_profile = color_profile
        self.dpi = max(150, min(1200, dpi))
        self.bleed_mm = max(0.0, bleed_mm)
        self.show_crop_marks = show_crop_marks
        self.canvas_manifest_b64 = canvas_manifest_b64
        self.pair_context_pages = pair_context_pages
        self._image_cache: OrderedDict[tuple[Any, ...], tuple[bytes, int, int]] = OrderedDict()
        self._image_cache_max = 128
        self._image_cache_max_bytes = _IMAGE_CACHE_MAX_BYTES
        self._image_cache_bytes = 0
        self._layer_renderers: dict[str, Callable[[_LayerRenderCall], None]] = {
            "rect": self._render_rect_frame,
            "frame": self._render_rect_frame,
            "ellipse": self._render_ellipse,
            "line": self._render_line,
            "arrow": self._render_line,
            "text": self._render_text,
            "field": self._render_text,
            "image": self._render_image,
            "logo": self._render_image,
            "imageSlot": self._render_image,
            "group": self._render_noop,
        }

        page_meta = document.get("page", {})
        self.page_w_mm = float(page_meta.get("widthMm", 210))
        self.page_h_mm = float(page_meta.get("heightMm", 297))

    def render(self, local_image_paths: dict[str, str] | None = None) -> bytes:
        local_image_paths = local_image_paths or {}
        pdf = fitz.open()
        try:
            bleed_pt = self.bleed_mm * MM_TO_PT
            trim_w_pt = self.page_w_mm * MM_TO_PT
            trim_h_pt = self.page_h_mm * MM_TO_PT

            crop_margin_pt = (10.0 * MM_TO_PT) if self.show_crop_marks else 0.0
            media_w_pt = trim_w_pt + 2 * (bleed_pt + crop_margin_pt)
            media_h_pt = trim_h_pt + 2 * (bleed_pt + crop_margin_pt)

            origin_x_pt = bleed_pt + crop_margin_pt
            origin_y_pt = bleed_pt + crop_margin_pt

            pages = self.document.get("pages") or [{"id": "page-1", "name": "Página 1"}]
            layers = self.document.get("layers") or []

            if self.pair_context_pages and len(self.contexts) == len(pages):
                render_pairs: list[tuple[dict[str, Any], int]] = [
                    (self.contexts[i], i) for i in range(len(pages))
                ]
            else:
                render_pairs = [
                    (ctx, page_idx)
                    for ctx in self.contexts
                    for page_idx in range(len(pages))
                ]

            for ctx, page_idx in render_pairs:
                page = pdf.new_page(width=media_w_pt, height=media_h_pt)
                media_rect = fitz.Rect(0, 0, media_w_pt, media_h_pt)
                page.set_mediabox(media_rect)

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

                page_layers = [
                    layer for layer in layers if layer.get("pageIndex", 0) == page_idx and layer.get("visible", True)
                ]
                shape = page.new_shape()

                for layer in page_layers:
                    if layer.get("type") in ("text", "field", "image", "logo", "imageSlot"):
                        shape = self._flush_shape(page, shape)
                    self._render_layer(page, shape, layer, ctx, origin_x_pt, origin_y_pt, local_image_paths)

                shape.commit()

            manifest = _decode_canvas_manifest(self.canvas_manifest_b64)
            if manifest is not None:
                pdf.embfile_add(
                    _CANVAS_MANIFEST_FILENAME,
                    manifest,
                    filename=_CANVAS_MANIFEST_FILENAME,
                    ufilename=_CANVAS_MANIFEST_FILENAME,
                    desc="Antares Canvas document manifest",
                )
            return cast(bytes, pdf.tobytes(clean=True, deflate=True))
        finally:
            pdf.close()

    def _flush_shape(self, page: fitz.Page, shape: fitz.Shape) -> fitz.Shape:
        shape.commit()
        return cast(fitz.Shape, page.new_shape())

    def _draw_crop_marks(self, page: fitz.Page, trim: fitz.Rect, margin_pt: float) -> None:
        shape = page.new_shape()
        mark_len = margin_pt * 0.6
        mark_offset = margin_pt * 0.2
        cmyk_black = (0.0, 0.0, 0.0, 1.0)

        shape.draw_line(
            fitz.Point(trim.x0 - mark_offset - mark_len, trim.y0),
            fitz.Point(trim.x0 - mark_offset, trim.y0),
        )
        shape.draw_line(
            fitz.Point(trim.x0, trim.y0 - mark_offset - mark_len),
            fitz.Point(trim.x0, trim.y0 - mark_offset),
        )

        shape.draw_line(
            fitz.Point(trim.x1 + mark_offset, trim.y0),
            fitz.Point(trim.x1 + mark_offset + mark_len, trim.y0),
        )
        shape.draw_line(
            fitz.Point(trim.x1, trim.y0 - mark_offset - mark_len),
            fitz.Point(trim.x1, trim.y0 - mark_offset),
        )

        shape.draw_line(
            fitz.Point(trim.x0 - mark_offset - mark_len, trim.y1),
            fitz.Point(trim.x0 - mark_offset, trim.y1),
        )
        shape.draw_line(
            fitz.Point(trim.x0, trim.y1 + mark_offset),
            fitz.Point(trim.x0, trim.y1 + mark_offset + mark_len),
        )

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

    def _render_rect_frame(self, call: _LayerRenderCall) -> None:
        paint = call.paint
        _draw_shape_rect(
            call.shape,
            paint.rect,
            paint.rotate_deg,
            bg_cmyk=paint.bg_cmyk,
            border_cmyk=paint.border_cmyk,
            border_width_pt=paint.border_width_pt,
        )

    def _render_ellipse(self, call: _LayerRenderCall) -> None:
        paint = call.paint
        if paint.rotate_deg:
            logger.warning("CMYK renderer skips rotation for ellipse layers (not a true rotated oval)")
        call.shape.draw_oval(paint.rect)
        if paint.bg_cmyk or paint.border_cmyk:
            call.shape.finish(
                color=paint.border_cmyk,
                fill=paint.bg_cmyk,
                width=paint.border_width_pt or 1.0,
            )

    def _render_line(self, call: _LayerRenderCall) -> None:
        paint = call.paint
        p1 = fitz.Point(paint.x, paint.y + paint.h / 2)
        p2 = fitz.Point(paint.x + paint.w, paint.y + paint.h / 2)
        call.shape.draw_line(p1, p2)
        stroke_cmyk = paint.border_cmyk or (0.0, 0.0, 0.0, 1.0)
        call.shape.finish(color=stroke_cmyk, width=max(1.0, paint.border_width_pt))

    def _render_text(self, call: _LayerRenderCall) -> None:
        paint = call.paint
        raw_val = str(call.layer.get("value") or "")
        if not raw_val:
            key = (call.layer.get("meta") or {}).get("key")
            if key:
                data = call.ctx.get("data") or {}
                raw_val = str(data.get(key) or "")
        text_val = _resolve_template_value(raw_val, call.ctx)

        if paint.bg_cmyk or paint.border_cmyk:
            _draw_shape_rect(
                call.shape,
                paint.rect,
                paint.rotate_deg,
                bg_cmyk=paint.bg_cmyk,
                border_cmyk=paint.border_cmyk,
                border_width_pt=paint.border_width_pt,
            )

        color_str = call.css_vars.get("--color") or call.css_vars.get("color") or "#000000"
        text_cmyk = css_color_to_cmyk(color_str)
        font_size_pt = _parse_length_pt(call.css_vars.get("--font-size"), 4)
        font_size_pt = max(6.0, font_size_pt)

        call.page.insert_textbox(
            paint.rect,
            text_val,
            fontsize=font_size_pt,
            fontname=_map_font_family(call.css_vars.get("--font-family")),
            fill=text_cmyk,
            align=_text_align(call.css_vars),
            rotate=round(paint.rotate_deg),
        )

    def _render_image(self, call: _LayerRenderCall) -> None:
        paint = call.paint
        resolved_src = _resolve_image_src(call.layer, call.ctx)
        if resolved_src:
            resolved_src = _resolve_template_value(resolved_src, call.ctx)

        object_fit = call.css_vars.get("--object-fit")
        if resolved_src:
            try:
                prepared = self._prepare_image_for_rect_cached(
                    resolved_src,
                    call.local_image_paths,
                    paint.rect,
                    object_fit,
                )
            except Exception:
                prepared = None
            if prepared is not None:
                cmyk_bytes, insert_rect = prepared
                call.page.insert_image(
                    insert_rect,
                    stream=cmyk_bytes,
                    rotate=round(paint.rotate_deg),
                )
            else:
                call.shape.draw_rect(paint.rect)
                call.shape.finish(color=(0, 0, 0, 0.5))
        else:
            call.shape.draw_rect(paint.rect)
            call.shape.finish(color=(0, 0, 0, 0.5))

    def _render_noop(self, call: _LayerRenderCall) -> None:
        return

    def _render_fallback(self, call: _LayerRenderCall) -> None:
        paint = call.paint
        if paint.bg_cmyk or paint.border_cmyk:
            call.shape.draw_rect(paint.rect)
            call.shape.finish(
                color=paint.border_cmyk,
                fill=paint.bg_cmyk,
                width=paint.border_width_pt or 1.0,
            )
        else:
            call.shape.draw_rect(paint.rect)
            call.shape.finish(color=(0.0, 0.0, 0.0, 0.35), width=0.5)

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

        paint = _LayerPaint(
            rect=fitz.Rect(x, y, x + w, y + h),
            x=x,
            y=y,
            w=w,
            h=h,
            rotate_deg=_parse_rotate_deg(css_vars),
            bg_cmyk=bg_cmyk,
            border_cmyk=border_cmyk,
            border_width_pt=border_width_pt,
        )

        handler = self._layer_renderers.get(l_type, self._render_fallback)
        handler(
            _LayerRenderCall(
                page=page,
                shape=shape,
                layer=layer,
                ctx=ctx,
                css_vars=css_vars,
                paint=paint,
                local_image_paths=local_image_paths,
            )
        )
