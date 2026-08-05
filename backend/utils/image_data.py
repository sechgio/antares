"""Helpers for embedding validated image bytes in HTML documents."""

from __future__ import annotations

import base64
from io import BytesIO

_IMAGE_MIME_TYPES = {
    "BMP": "image/bmp",
    "GIF": "image/gif",
    "ICO": "image/x-icon",
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "TIFF": "image/tiff",
    "WEBP": "image/webp",
}


def data_uri_from_bytes(content: bytes, default_mime: str = "image/png") -> str:
    """Return a data URI whose MIME matches the image format when detectable."""
    mime = default_mime
    try:
        from PIL import Image

        with Image.open(BytesIO(content)) as image:
            mime = _IMAGE_MIME_TYPES.get(image.format or "", default_mime)
    except Exception:
        pass
    encoded = base64.b64encode(content).decode("ascii")
    return f"data:{mime};base64,{encoded}"
