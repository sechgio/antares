
from __future__ import annotations

from PIL import Image

MAX_IMAGE_PIXELS = 100_000_000


def apply_default_pixels_limit() -> None:
    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
