from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from backend.utils.paths import resource_path

BUNDLED_FONTS_DIR = "media/fonts"

DEFAULT_FONT_ID = "dejavu-sans"

SYSTEM_FALLBACKS: dict[str, str] = {
    "sans": "C:/Windows/Fonts/segoeui.ttf",
    "sans-bold": "C:/Windows/Fonts/segoeuib.ttf",
    "sans-italic": "C:/Windows/Fonts/segoeuii.ttf",
    "sans-bold-italic": "C:/Windows/Fonts/segoeuiz.ttf",
    "mono": "C:/Windows/Fonts/consola.ttf",
}


@dataclass(frozen=True)
class FontEntry:
    font_id: str
    family: str
    weight: str
    style: str
    path: Path | None
    bundled: bool


def _bundled_path(family: str, weight: str, style: str) -> Path | None:
    suffix = f"{family}-{weight}{style}.ttf" if style != "normal" else f"{family}-{weight}.ttf"
    candidate = resource_path(f"{BUNDLED_FONTS_DIR}/{suffix}")
    return candidate if candidate.is_file() else None


def _system_path(family: str, weight: str, style: str) -> Path | None:
    if family not in SYSTEM_FALLBACKS:
        family = "sans"
    variants = []
    if weight == "bold":
        variants.append("bold")
    if style == "italic":
        variants.append("italic")
    key = family if not variants else f"{family}-{'-'.join(variants)}"
    raw = SYSTEM_FALLBACKS.get(key)
    if not raw:
        return None
    candidate = Path(raw)
    return candidate if candidate.is_file() else None


def resolve_font(
    font_id: str = DEFAULT_FONT_ID,
    *,
    bold: bool = False,
    italic: bool = False,
) -> FontEntry:
    family = font_id if font_id else DEFAULT_FONT_ID
    weight = "bold" if bold else "regular"
    style = "italic" if italic else "normal"

    bundled = _bundled_path(family, weight, style)
    if bundled is not None:
        return FontEntry(font_id=family, family=family, weight=weight, style=style, path=bundled, bundled=True)

    if os.environ.get("ANTARES_EDITOR_ALLOW_SYSTEM_FONTS") == "1":
        system = _system_path(family, weight, style)
        if system is not None:
            return FontEntry(font_id=family, family=family, weight=weight, style=style, path=system, bundled=False)

    raise FontNotFoundError(
        f"la fuente «{family}» ({weight}/{style}) no está disponible; "
        f"empaquétala en {BUNDLED_FONTS_DIR}/ o activa ANTTARES_EDITOR_ALLOW_SYSTEM_FONTS=1 en desarrollo"
    )


class FontNotFoundError(RuntimeError):
    pass


