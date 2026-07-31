"""Color conversion utilities for CMYK print-ready rendering."""

from __future__ import annotations

import io
import re

from PIL import Image


def hex_to_rgb(hex_str: str) -> tuple[float, float, float]:
    """Convert hex color string (#RGB or #RRGGBB) to RGB floats in range [0.0, 1.0]."""
    cleaned = hex_str.lstrip("#").strip()
    if len(cleaned) == 3:
        cleaned = "".join(c * 2 for c in cleaned)
    if len(cleaned) != 6:
        return (0.0, 0.0, 0.0)
    try:
        r = int(cleaned[0:2], 16) / 255.0
        g = int(cleaned[2:4], 16) / 255.0
        b = int(cleaned[4:6], 16) / 255.0
        return (max(0.0, min(1.0, r)), max(0.0, min(1.0, g)), max(0.0, min(1.0, b)))
    except ValueError:
        return (0.0, 0.0, 0.0)


def parse_css_color_to_rgb(color_str: str) -> tuple[float, float, float]:
    """Parse common CSS color representations (#hex, rgb(), rgba(), named) to RGB floats [0.0, 1.0]."""
    if not color_str or not isinstance(color_str, str):
        return (0.0, 0.0, 0.0)
    val = color_str.strip().lower()
    if val in ("transparent", "none", ""):
        return (1.0, 1.0, 1.0)
    if val.startswith("#"):
        return hex_to_rgb(val)
    rgb_match = re.match(r"^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", val)
    if rgb_match:
        try:
            r = int(rgb_match.group(1)) / 255.0
            g = int(rgb_match.group(2)) / 255.0
            b = int(rgb_match.group(3)) / 255.0
            return (max(0.0, min(1.0, r)), max(0.0, min(1.0, g)), max(0.0, min(1.0, b)))
        except ValueError:
            return (0.0, 0.0, 0.0)

    named_colors: dict[str, tuple[float, float, float]] = {
        "black": (0.0, 0.0, 0.0),
        "white": (1.0, 1.0, 1.0),
        "red": (1.0, 0.0, 0.0),
        "green": (0.0, 0.5, 0.0),
        "blue": (0.0, 0.0, 1.0),
        "yellow": (1.0, 1.0, 0.0),
        "cyan": (0.0, 1.0, 1.0),
        "magenta": (1.0, 0.0, 1.0),
        "gray": (0.5, 0.5, 0.5),
        "grey": (0.5, 0.5, 0.5),
        "lightgray": (0.83, 0.83, 0.83),
        "darkgray": (0.66, 0.66, 0.66),
    }
    return named_colors.get(val, (0.0, 0.0, 0.0))


def rgb_to_cmyk(r: float, g: float, b: float) -> tuple[float, float, float, float]:
    """Convert RGB float values [0.0, 1.0] to CMYK floats [0.0, 1.0]."""
    r = max(0.0, min(1.0, r))
    g = max(0.0, min(1.0, g))
    b = max(0.0, min(1.0, b))

    if r == 0.0 and g == 0.0 and b == 0.0:
        return (0.0, 0.0, 0.0, 1.0)

    k = 1.0 - max(r, g, b)
    if k >= 1.0:
        return (0.0, 0.0, 0.0, 1.0)

    c = (1.0 - r - k) / (1.0 - k)
    m = (1.0 - g - k) / (1.0 - k)
    y = (1.0 - b - k) / (1.0 - k)

    return (
        max(0.0, min(1.0, c)),
        max(0.0, min(1.0, m)),
        max(0.0, min(1.0, y)),
        max(0.0, min(1.0, k)),
    )


def css_color_to_cmyk(color_str: str) -> tuple[float, float, float, float]:
    """Parse CSS color string directly to CMYK floats [0.0, 1.0]."""
    r, g, b = parse_css_color_to_rgb(color_str)
    return rgb_to_cmyk(r, g, b)


def convert_pil_to_cmyk_bytes(img: Image.Image, dpi: int = 300) -> bytes:
    """Convert a Pillow Image (RGB, RGBA, P, etc.) to a high-DPI CMYK JPEG buffer."""
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode != "RGBA":
            img = img.convert("RGBA")
        bg.paste(img, mask=img.split()[3])
        rgb_img = bg
    elif img.mode != "RGB":
        rgb_img = img.convert("RGB")
    else:
        rgb_img = img

    cmyk_img = rgb_img.convert("CMYK")

    buf = io.BytesIO()
    cmyk_img.save(buf, format="JPEG", quality=95, dpi=(dpi, dpi))
    return buf.getvalue()
