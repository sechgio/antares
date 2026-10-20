"""Rasterizado de títulos del editor (L4, plan §4.5).

El texto se rasteriza una vez a RGBA a resolución de salida y el mismo
bitmap se usa en preview y exportación, con la misma política de
métricas, salto de línea y fallback de fuente en ambos caminos. El
contenido nunca se interpreta como HTML ni se inyecta en filtergraphs:
llega como cadena y se dibuja con Pillow.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from backend.core.editor.fonts import resolve_font


class TextRenderError(ValueError):
    """El título no puede rasterizarse."""


def _font_for(text_clip: dict[str, Any], scale: float) -> Any:  # allowlist: dict[str, Any]
    """Fuente escalada a la resolución de salida."""
    entry = resolve_font(
        str(text_clip.get("fontId") or ""),
        bold=bool(text_clip.get("style", {}).get("bold", False)),
        italic=bool(text_clip.get("style", {}).get("italic", False)),
    )
    if entry.path is None:
        raise TextRenderError(f"fuente no resuelta: {entry.font_id}")
    size = max(8, round(int(text_clip["fontSizePx"]) * scale))
    try:
        return ImageFont.truetype(str(entry.path), size)
    except OSError as exc:
        raise TextRenderError(f"no se pudo abrir la fuente {entry.path}: {exc}") from exc


def text_cache_key(text_clip: dict[str, Any], width: int, height: int) -> str:  # allowlist: dict[str, Any]
    """Clave de caché estable del bitmap rasterizado."""
    payload = repr(sorted((str(k), str(v)) for k, v in _render_params(text_clip, width, height).items()))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def _render_params(text_clip: dict[str, Any], width: int, height: int) -> dict[str, Any]:  # allowlist: dict[str, Any]
    style = text_clip.get("style", {})
    return {
        "content": text_clip.get("content", ""),
        "fontId": text_clip.get("fontId", ""),
        "fontSizePx": text_clip.get("fontSizePx"),
        "color": text_clip.get("color"),
        "align": text_clip.get("align"),
        "bold": style.get("bold"),
        "italic": style.get("italic"),
        "underline": style.get("underline"),
        "strokeWidthPx": style.get("strokeWidthPx"),
        "strokeColor": style.get("strokeColor"),
        "width": width,
        "height": height,
    }


def _text_fields(text_clip: dict[str, Any]) -> dict[str, Any]:  # allowlist: dict[str, Any]
    """Normaliza el clip: los campos de título pueden venir anidados en
    ``text`` (contrato del schema) o planos en el clip."""
    if "text" in text_clip and isinstance(text_clip["text"], dict):
        nested = dict(text_clip["text"])
        # El transform y la duración viven en el clip.
        nested.setdefault("fontId", "dejavu-sans")
        return nested
    return text_clip


def render_text_bitmap(
    text_clip: dict[str, Any],  # allowlist: dict[str, Any]
    width: int,
    height: int,
    *,
    cache_dir: Path | None = None,
) -> Path:
    """Rasteriza el título a un PNG RGBA del tamaño del lienzo.

    El lienzo es transparente salvo el texto, así puede superponerse
    con ``overlay`` sin tapar la capa inferior. El resultado se cachea
    por clave derivada de los parámetros: preview y export comparten el
    mismo archivo.
    """
    if width <= 0 or height <= 0:
        raise TextRenderError("el lienzo debe tener dimensiones positivas")

    fields = _text_fields(text_clip)
    key = text_cache_key(fields, width, height)
    if cache_dir is not None:
        cached = cache_dir / f"{key}.png"
        if cached.is_file():
            return cached

    content = str(fields.get("content", ""))
    if not content:
        raise TextRenderError("el título no tiene contenido")

    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    box = fields.get("box", {})
    box_x = float(box.get("x", 0.0)) * width
    box_y = float(box.get("y", 0.0)) * height
    box_w = float(box.get("width", 1.0)) * width
    box_h = float(box.get("height", 0.2)) * height

    # Escala de fuente relativa al lienzo para que el mismo clip se vea
    # igual en preview (lienzo reducido) y export (resolución final).
    ref = max(width, height)
    scale = ref / 720.0 if ref > 0 else 1.0
    font = _font_for(fields, scale)

    color = str(fields.get("color", "#FFFFFF"))
    rgb = _hex_to_rgb(color)
    style = fields.get("style", {})
    stroke_width = int(style.get("strokeWidthPx", 0) or 0)
    stroke_fill = _hex_to_rgb(style.get("strokeColor", "#000000")) if stroke_width > 0 else None

    lines = _wrap_lines(draw, content, font, max(1, int(box_w)))
    line_height = _line_height(font)
    align = str(fields.get("align", "center"))

    # Saltos de línea multilínea centrados verticalmente en la caja.
    total_h = line_height * len(lines)
    y = box_y + max(0.0, (box_h - total_h) / 2)
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font, stroke_width=stroke_width)
        text_w = bbox[2] - bbox[0]
        if align == "left":
            x = box_x
        elif align == "right":
            x = box_x + box_w - text_w
        else:
            x = box_x + max(0.0, (box_w - text_w) / 2)
        draw.text(
            (x, y),
            line,
            font=font,
            fill=(*rgb, 255),
            stroke_width=stroke_width,
            stroke_fill=stroke_fill,
        )
        if style.get("underline"):
            underline_y = y + line_height * 0.88
            draw.rectangle(
                [(x, underline_y), (x + text_w, underline_y + max(1, line_height * 0.06))],
                fill=(*rgb, 255),
            )
        y += line_height

    if cache_dir is not None:
        cache_dir.mkdir(parents=True, exist_ok=True)
        tmp = cache_dir / f".{key}.tmp.png"
        image.save(tmp, format="PNG")
        tmp.replace(cache_dir / f"{key}.png")
        return cache_dir / f"{key}.png"
    return _bitmap_to_temp(image, key)


def _bitmap_to_temp(image: Any, key: str) -> Path:
    import tempfile

    directory = Path(tempfile.gettempdir()) / "antares-editor-text"
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"{key}.png"
    image.save(target, format="PNG")
    return target


def _wrap_lines(draw: Any, content: str, font: Any, max_width: float) -> list[str]:
    """Salto de línea por ancho de caja, respetando saltos explícitos."""
    lines: list[str] = []
    for paragraph in content.split("\n"):
        if not paragraph:
            lines.append("")
            continue
        current = ""
        for word in paragraph.split(" "):
            candidate = f"{current} {word}".strip()
            if draw.textlength(candidate, font=font) <= max_width or not current:
                current = candidate
            else:
                lines.append(current)
                current = word
        lines.append(current)
    return lines


def _line_height(font: Any) -> float:
    ascent, descent = font.getmetrics()
    return float(ascent + descent) * 1.2


def _hex_to_rgb(value: Any) -> tuple[int, int, int]:
    text = str(value or "#FFFFFF").lstrip("#")
    if len(text) == 6:
        try:
            return int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16)
        except ValueError:
            pass
    return 255, 255, 255
