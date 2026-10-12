"""Registro de fuentes locales del editor (L4, plan §4.5).

Las fuentes se resuelven por ``fontId`` desde un registro explícito.
La fuente por defecto está empaquetada en ``media/fonts/`` para que el
editor funcione sin conexión y sin depender de fuentes descargadas. En
desarrollo sin el paquete preparado se admite el fallback a fuentes del
sistema, siempre declarado aquí y nunca implícito.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from backend.utils.paths import resource_path

BUNDLED_FONTS_DIR = "media/fonts"

# Fuente por defecto del editor: DejaVu Sans, licencia libre (Bitstream
# Vera + permisos adicionales), con cobertura de acentos, ñ y glifos
# latinos amplios. Se empaqueta con el instalador.
DEFAULT_FONT_ID = "dejavu-sans"

# Fuentes del sistema admitidas como fallback en desarrollo, mapeadas
# por familia. No se buscan por nombre libre: solo estas entradas.
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
    weight: str  # "regular" | "bold"
    style: str  # "normal" | "italic"
    path: Path | None
    bundled: bool


def _bundled_path(family: str, weight: str, style: str) -> Path | None:
    """Busca la fuente en el paquete preparado ``media/fonts/``."""
    suffix = f"{family}-{weight}{style}.ttf" if style != "normal" else f"{family}-{weight}.ttf"
    candidate = resource_path(f"{BUNDLED_FONTS_DIR}/{suffix}")
    return candidate if candidate.is_file() else None


def _system_path(family: str, weight: str, style: str) -> Path | None:
    # Familia desconocida (p. ej. dejavu-sans sin empaquetar) cae a la
    # familia sans del sistema: el editor nunca depende de un nombre
    # libre de fuente, solo de este registro.
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
    """Resuelve una fuente del registro a una ruta de archivo.

    Prioriza el paquete bundled (offline garantizado); si no está
    preparado, cae a las fuentes del sistema declaradas arriba. Nunca
    busca fuentes por nombre libre ni descarga nada.
    """
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
    """La fuente solicitada no está en el registro ni en el sistema."""


def available_fonts() -> list[FontEntry]:
    """Fuentes resolubles ahora mismo (bundled primero)."""
    out: list[FontEntry] = []
    for family, weight, style in (
        (DEFAULT_FONT_ID, "regular", "normal"),
        (DEFAULT_FONT_ID, "bold", "normal"),
    ):
        try:
            out.append(resolve_font(family, bold=weight == "bold", italic=style == "italic"))
        except FontNotFoundError:
            continue
    return out
