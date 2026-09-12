from __future__ import annotations

import logging
from io import BytesIO
from typing import Any, cast

from PIL import Image, ImageDraw, ImageFont, ImageOps

from backend.core.ubicaciones.client import _is_na, _parse_combined_coord_value
from backend.utils.validators import sanitizar_nombre

logger = logging.getLogger(__name__)

_REF_LAYOUT: dict[str, dict[str, int | float]] = {
    "vertical": {
        "out_w": 2480,
        "out_h": 3508,
        "footer_h": 122,
        "preview_w": 600,
        "y_start": 120,
        "line_spacing": 180,
        "line_gap": 0.7,
        "pin_scale": 0.15,
        "font_large": 120,
        "font_medium": 60,
        "stroke_large": 12,
        "stroke_medium": 8,
        "border": 4,
    },
    "horizontal": {
        "out_w": 3508,
        "out_h": 2480,
        "footer_h": 135,
        "preview_w": 850,
        "y_start": 180,
        "line_spacing": 260,
        "line_gap": 0.7,
        "pin_scale": 0.12,
        "font_large": 120,
        "font_medium": 60,
        "stroke_large": 12,
        "stroke_medium": 8,
        "border": 4,
    },
}
_PIN_TIP_X_RATIO = 0.4846
_PIN_TIP_RATIO = 0.7432
_MAP_OVERLAY_ALPHA = 120
_BG_RGB = (246, 246, 246)
_MAP_CAPTURE_VERSION = 5
_FOOTER_LAYOUT_VERSION = 2


def _get_font(bold: bool, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    from backend.core.ubicaciones.cache import _get_font as _fn

    return _fn(bold, size)


def _get_footer_image(width: int, height: int) -> Image.Image | None:
    from backend.core.ubicaciones.cache import _get_footer_image as _fn

    return _fn(width, height)


def _get_pin_rgba() -> Image.Image | None:
    from backend.core.ubicaciones.cache import _get_pin_rgba as _fn

    return _fn()


def _get_cached_map_screenshot(
    lat: float,
    lon: float,
    formato: str,
    *,
    preview: bool = False,
    map_opts: dict[str, Any] | None = None,  # allowlist: dict[str, Any]
) -> bytes:
    from backend.core.ubicaciones.cache import _get_cached_map_screenshot as _fn

    return _fn(lat, lon, formato, preview=preview, map_opts=map_opts)


def _hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    h = hex_str.lstrip("#")
    if len(h) == 3:
        h = h[0] * 2 + h[1] * 2 + h[2] * 2
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _colorize_pin(pin_rgba: Image.Image, target_rgb: tuple[int, int, int]) -> Image.Image:
    _r, _g, _b, a = pin_rgba.split()
    gray = pin_rgba.convert("L")
    colored = ImageOps.colorize(gray, black=(0, 0, 0), mid=target_rgb, white=(255, 255, 255))
    colored = colored.convert("RGBA")
    colored.putalpha(a)
    return colored


def _crop_footer_bar(img: Image.Image) -> Image.Image:
    rgb = img.convert("RGB")
    w, h = rgb.size
    step = max(1, w // 30)
    last_black = 0
    for y in range(h):
        total = 0.0
        count = 0
        for x in range(0, w, step):
            total += sum(cast(tuple[int, ...], rgb.getpixel((x, y))))
            count += 1
        if count and (total / count) < 120:
            last_black = y
    bar_h = max(1, last_black + 1)
    return rgb.crop((0, 0, w, bar_h))


def _is_gutter_pixel(r: int, g: int, b: int) -> bool:
    spread = max(r, g, b) - min(r, g, b)
    return r > 225 and g > 232 and b > 228 and spread < 40


def _column_is_gutter(img: Image.Image, x: int) -> bool:
    _w, h = img.size
    step = max(1, h // 80)
    return all(_is_gutter_pixel(*cast(tuple[int, int, int], img.getpixel((x, y)))) for y in range(0, h, step))


def _row_is_gutter(img: Image.Image, y: int) -> bool:
    w, _h = img.size
    step = max(1, w // 80)
    return all(_is_gutter_pixel(*cast(tuple[int, int, int], img.getpixel((x, y)))) for x in range(0, w, step))


def _trim_map_gutters(img: Image.Image) -> Image.Image:
    w, h = img.size
    left = 0
    while left < w - 20 and _column_is_gutter(img, left):
        left += 1
    right = w - 1
    while right > left + 20 and _column_is_gutter(img, right):
        right -= 1
    top = 0
    while top < h - 20 and _row_is_gutter(img, top):
        top += 1
    bottom = h - 1
    while bottom > top + 20 and _row_is_gutter(img, bottom):
        bottom -= 1
    return img.crop((left, top, right + 1, bottom + 1))


def _center_crop_to_aspect(img: Image.Image, width: int, height: int) -> Image.Image:
    target_aspect = width / height
    w, h = img.size
    src_aspect = w / h
    if src_aspect > target_aspect:
        new_w = max(1, int(h * target_aspect))
        left = (w - new_w) // 2
        return img.crop((left, 0, left + new_w, h))
    if src_aspect < target_aspect:
        new_h = max(1, int(w / target_aspect))
        top = (h - new_h) // 2
        return img.crop((0, top, w, top + new_h))
    return img


def _normalize_map_screenshot(screenshot_bytes: bytes, width: int, height: int) -> bytes:
    with Image.open(BytesIO(screenshot_bytes)) as opened:
        img = opened.convert("RGB")
    if img.size != (width, height):
        img = _center_crop_to_aspect(img, width, height)
    img = _trim_map_gutters(img)
    if img.size != (width, height):
        img = img.resize((width, height), Image.Resampling.LANCZOS)
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _dimensions_for(formato: str, *, preview: bool = False) -> tuple[int, int, int]:
    spec = _REF_LAYOUT[formato]
    out_w = int(spec["out_w"])
    out_h = int(spec["out_h"])
    footer_h = int(spec["footer_h"])
    if not preview:
        return out_w, out_h, footer_h
    scale = int(spec["preview_w"]) / out_w
    prev_w = round(out_w * scale)
    prev_h = round(out_h * scale)
    map_h = round((out_h - footer_h) * scale)
    prev_footer = max(1, prev_h - map_h)
    return prev_w, prev_h, prev_footer


def _map_capture_size(formato: str, *, preview: bool = False) -> tuple[int, int]:
    out_w, out_h, footer_h = _dimensions_for(formato, preview=preview)
    return out_w, out_h - footer_h


def _output_pdf_filename(cod_componente: str) -> str:
    safe_stem = sanitizar_nombre(str(cod_componente)) or "ubicacion"
    return f"{safe_stem}.pdf"


def _unique_pdf_filename(cod_componente: str, used_stems: dict[str, int]) -> str:
    stem = sanitizar_nombre(str(cod_componente)) or "ubicacion"
    count = used_stems.get(stem, 0)
    used_stems[stem] = count + 1
    if count == 0:
        return f"{stem}.pdf"
    return f"{stem}_{count + 1}.pdf"


def _parse_excel_columns(df: Any) -> tuple[Any, ...]:
    df.columns = [str(c).strip().lower() for c in df.columns]

    col_cod = next((c for c in df.columns if "cod" in c or "componente" in c), None)
    col_dir = next((c for c in df.columns if "direcci" in c), None)
    col_loc = next((c for c in df.columns if "localidad" in c or "urb" in c), None)
    col_dist = next((c for c in df.columns if "distrito" in c), None)
    col_lat = next((c for c in df.columns if "lat" in c), None)
    col_lon = next((c for c in df.columns if "lon" in c), None)

    if not col_lat or not col_lon:
        col_coord = next((c for c in df.columns if "coord" in c or "link" in c), None)
        if col_coord:
            parsed = df[col_coord].apply(_parse_combined_coord_value)
            df["lat_tmp"] = parsed.apply(lambda pair: pair[0])
            df["lon_tmp"] = parsed.apply(lambda pair: pair[1])
            col_lat = "lat_tmp"
            col_lon = "lon_tmp"
        else:
            return None, None, None, None, None, None

    return col_cod, col_dir, col_loc, col_dist, col_lat, col_lon


def _extract_row_data(
    row: Any,
    index: int,
    col_cod: Any,
    col_dir: Any,
    col_loc: Any,
    col_dist: Any,
    col_lat: Any,
    col_lon: Any,
) -> dict[str, Any]:  # allowlist: dict[str, Any]
    return {
        "cod_componente": row[col_cod] if col_cod and not _is_na(row[col_cod]) else f"ID-{index + 1}",
        "direccion": row[col_dir] if col_dir and not _is_na(row[col_dir]) else "",
        "localidad": row[col_loc] if col_loc and not _is_na(row[col_loc]) else "",
        "distrito": row[col_dist] if col_dist and not _is_na(row[col_dist]) else "",
        "lat": row[col_lat],
        "lon": row[col_lon],
    }


def _compose_ubicacion_image(
    datos: dict,
    formato: str,
    screenshot_bytes: bytes,
    *,
    preview: bool = False,
    custom_styles: dict | None = None,
) -> Image.Image:
    spec = _REF_LAYOUT[formato]
    out_w, out_h, footer_height = _dimensions_for(formato, preview=preview)
    scale = out_w / int(spec["out_w"])

    cs_texts = (custom_styles or {}).get("texts", {})
    cs_pin = (custom_styles or {}).get("pin", {})
    cs_map = (custom_styles or {}).get("map", {})
    cs_layout = (custom_styles or {}).get("layout", {})

    final_img = Image.new("RGB", (out_w, out_h), _BG_RGB)

    map_height = out_h - footer_height
    with Image.open(BytesIO(screenshot_bytes)) as opened:
        mapa = opened.convert("RGBA")
    resample = Image.Resampling.LANCZOS
    target_map_size = (out_w, map_height)
    if mapa.size != target_map_size:
        mapa = mapa.resize(target_map_size, resample)

    overlay_alpha = cs_map.get("overlayAlpha", _MAP_OVERLAY_ALPHA)
    overlay_color = _hex_to_rgb(cs_map["overlayColor"]) if "overlayColor" in cs_map else _BG_RGB
    overlay = Image.new("RGBA", (out_w, map_height), (*overlay_color, overlay_alpha))
    mapa_con_overlay = Image.alpha_composite(mapa, overlay)
    final_img.paste(mapa_con_overlay.convert("RGB"), (0, 0))

    footer_img = _get_footer_image(out_w, footer_height)
    draw = ImageDraw.Draw(final_img)
    if footer_img is not None:
        final_img.paste(footer_img, (0, out_h - footer_height))
    else:
        draw.rectangle([0, out_h - footer_height, out_w, out_h], fill=(0, 0, 0))

    border_w = max(1, round(int(spec["border"]) * scale))
    draw.rectangle([0, 0, out_w - 1, out_h - 1], outline=(0, 0, 0), width=border_w)

    cod = str(datos.get("cod_componente", ""))
    dir_str = str(datos.get("direccion", ""))
    loc = str(datos.get("localidad", ""))
    dist = str(datos.get("distrito", ""))

    y_start = round(cs_layout.get("yStart", int(spec["y_start"])) * scale)
    line_spacing = round(cs_layout.get("lineSpacing", int(spec["line_spacing"])) * scale)
    line_gap = cs_layout.get("lineGap", float(spec["line_gap"]))

    def _draw_field(field: str, text: str, default_size: int, y_pos: int, *, is_large: bool = False) -> None:
        ts = cs_texts.get(field, {})
        if not ts.get("visible", True):
            return
        font_size = max(8, round(ts.get("fontSize", default_size) * scale))
        bold = ts.get("bold", True)
        color = _hex_to_rgb(ts["color"]) if "color" in ts else (0, 0, 0)
        offset_x = round(ts.get("offsetX", 0) * scale)
        offset_y = round(ts.get("offsetY", 0) * scale)
        stroke_key = "stroke_large" if is_large else "stroke_medium"
        stroke_w = max(1, round(int(spec[stroke_key]) * scale))
        font = _get_font(bold, font_size)
        bbox = draw.textbbox((0, 0), text, font=font)
        w_text = bbox[2] - bbox[0]
        x = (out_w - w_text) // 2 + offset_x
        y = y_pos + offset_y
        if field == "direccion" and w_text > out_w * 0.8:
            x = int(out_w * 0.1) + offset_x
        draw.text((x, y), text, fill=color, font=font, stroke_width=stroke_w, stroke_fill=(255, 255, 255))

    y_text = y_start
    _draw_field("cod_componente", cod, int(spec["font_large"]), y_text, is_large=True)

    y_text += line_spacing
    _draw_field("direccion", dir_str, int(spec["font_medium"]), y_text)

    y_text += round(line_spacing * line_gap)
    _draw_field("localidad", loc, int(spec["font_medium"]), y_text)

    y_text += round(line_spacing * line_gap)
    _draw_field("distrito", dist, int(spec["font_medium"]), y_text)

    if cs_pin.get("visible", True):
        pin = _get_pin_rgba()
        if pin is not None:
            pin_scale_val = cs_pin.get("scale", float(spec["pin_scale"]))
            new_pin_w = max(1, int(out_w * pin_scale_val))
            new_pin_h = max(1, int(pin.height * (new_pin_w / pin.width)))
            pin_resized = pin.resize((new_pin_w, new_pin_h), resample)
            pin_color_hex = cs_pin.get("color")
            if pin_color_hex:
                pin_resized = _colorize_pin(pin_resized, _hex_to_rgb(pin_color_hex))
            pin_offset_x = round(cs_pin.get("offsetX", 0) * scale)
            pin_offset_y = round(cs_pin.get("offsetY", 0) * scale)
            pin_x = round(out_w / 2 - new_pin_w * _PIN_TIP_X_RATIO) + pin_offset_x
            pin_y = round(map_height / 2 - new_pin_h * _PIN_TIP_RATIO) + pin_offset_y
            final_img.paste(pin_resized, (pin_x, pin_y), mask=pin_resized)

    return final_img


def render_ubicacion(
    datos: dict,
    formato: str,
    *,
    preview: bool = False,
    map_opts: dict[str, Any] | None = None,  # allowlist: dict[str, Any]
    custom_styles: dict | None = None,
) -> Image.Image:
    lat = float(datos["lat"])
    lon = float(datos["lon"])
    screenshot_bytes = _get_cached_map_screenshot(lat, lon, formato, preview=preview, map_opts=map_opts)
    return _compose_ubicacion_image(datos, formato, screenshot_bytes, preview=preview, custom_styles=custom_styles)


def render_imagen_ubicacion(
    datos: dict,
    formato: str,
    map_opts: dict[str, Any] | None = None,  # allowlist: dict[str, Any]
    custom_styles: dict | None = None,
) -> Image.Image:
    return render_ubicacion(datos, formato, preview=False, map_opts=map_opts, custom_styles=custom_styles)


def generar_imagen_ubicacion(
    datos: dict,
    output_path: str,
    formato: str,
    map_opts: dict[str, Any] | None = None,  # allowlist: dict[str, Any]
    custom_styles: dict | None = None,
) -> None:
    final_img = render_imagen_ubicacion(datos, formato, map_opts=map_opts, custom_styles=custom_styles)
    try:
        rgb = final_img.convert("RGB")
        try:
            rgb.save(output_path, "PDF", resolution=300.0)
        finally:
            rgb.close()
    finally:
        final_img.close()


__all__ = [
    "_BG_RGB",
    "_FOOTER_LAYOUT_VERSION",
    "_MAP_CAPTURE_VERSION",
    "_MAP_OVERLAY_ALPHA",
    "_PIN_TIP_RATIO",
    "_PIN_TIP_X_RATIO",
    "_REF_LAYOUT",
    "_center_crop_to_aspect",
    "_colorize_pin",
    "_column_is_gutter",
    "_compose_ubicacion_image",
    "_crop_footer_bar",
    "_dimensions_for",
    "_extract_row_data",
    "_hex_to_rgb",
    "_is_gutter_pixel",
    "_map_capture_size",
    "_normalize_map_screenshot",
    "_output_pdf_filename",
    "_parse_excel_columns",
    "_row_is_gutter",
    "_trim_map_gutters",
    "_unique_pdf_filename",
    "generar_imagen_ubicacion",
    "render_imagen_ubicacion",
    "render_ubicacion",
]
