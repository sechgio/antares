
from __future__ import annotations

import base64
import contextlib
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


def _detect_mime_from_b64_sample(b64_string: str, default_mime: str) -> str:
    sample = b64_string[:24]
    sample += "=" * ((4 - len(sample) % 4) % 4)
    header = base64.b64decode(sample, validate=True)
    if header.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if header.startswith(b"\x89PNG"):
        return "image/png"
    if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "image/webp"
    return default_mime


def data_uri_from_bytes(content: bytes, default_mime: str = "image/png") -> str:
    mime = default_mime
    try:
        from PIL import Image

        with Image.open(BytesIO(content)) as image:
            mime = _IMAGE_MIME_TYPES.get(image.format or "", default_mime)
    except Exception:
        pass
    encoded = base64.b64encode(content).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _strip_data_uri_prefix(b64_string: str) -> str:
    if b64_string.startswith("data:"):
        header_end = b64_string.find(",")
        if header_end != -1:
            return b64_string[header_end + 1 :]
    return b64_string


def decode_b64_payload(content_b64: str) -> bytes:
    clean = _strip_data_uri_prefix(content_b64).strip()
    missing_padding = len(clean) % 4
    if missing_padding:
        clean += "=" * (4 - missing_padding)
    try:
        return base64.b64decode(clean, validate=True)
    except Exception as exc:
        msg = f"No se pudo decodificar el contenido base64: {exc}"
        raise ValueError(msg) from exc


def data_uri_from_b64(b64_string: str, default_mime: str = "image/png") -> str:
    b64_clean = _strip_data_uri_prefix(b64_string)
    mime = default_mime
    with contextlib.suppress(Exception):
        mime = _detect_mime_from_b64_sample(b64_clean, default_mime)
    return f"data:{mime};base64,{b64_clean}"


def valid_image_bytes(content: bytes) -> bool:
    try:
        from PIL import Image

        with Image.open(BytesIO(content)) as image:
            image.verify()
        return True
    except Exception:
        return False


def valid_b64_image(b64_string: str) -> bool:
    b64_clean = _strip_data_uri_prefix(b64_string)
    try:
        content = base64.b64decode(b64_clean, validate=True)
    except Exception:
        return False
    return valid_image_bytes(content)


def contain_fit_cm(content: bytes, max_width_cm: float, max_height_cm: float) -> tuple[float, float]:
    try:
        from PIL import Image

        with Image.open(BytesIO(content)) as image:
            width_px, height_px = image.size
    except Exception:
        return max_width_cm, max_height_cm
    if width_px <= 0 or height_px <= 0:
        return max_width_cm, max_height_cm
    scale = min(max_width_cm / width_px, max_height_cm / height_px)
    return width_px * scale, height_px * scale
