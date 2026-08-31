"""Pillow decompression-bomb guard — single source of truth.

Una imagen con dimensiones enormes decodifica a cientos de MB (bomba de
descompresión). El tope se aplica una vez a nivel de proceso y lo heredan todos
los decodificadores (converter, cmyk, sellador, ubicaciones...), evitando que
dos módulos definan límites distintos y deriven.
"""

from __future__ import annotations

from PIL import Image

MAX_IMAGE_PIXELS = 100_000_000


def apply_default_pixels_limit() -> None:
    """Aplicar el tope de píxeles global de Pillow (idempotente)."""
    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
