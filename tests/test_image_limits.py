from __future__ import annotations

import warnings
from io import BytesIO

import pytest
from PIL import Image

from backend.core import image_limits


def test_decompression_bomb_warning_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    original_limit = Image.MAX_IMAGE_PIXELS
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", original_limit)
    monkeypatch.setattr(image_limits, "MAX_IMAGE_PIXELS", 4)
    buffer = BytesIO()
    Image.new("RGB", (3, 2)).save(buffer, format="PNG")

    with warnings.catch_warnings():
        image_limits.apply_default_pixels_limit()
        with pytest.raises(Image.DecompressionBombWarning):
            Image.open(BytesIO(buffer.getvalue()))
