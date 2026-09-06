
from __future__ import annotations

import base64
import math
from io import BytesIO

import pytest
from PIL import Image
from pypdf import PdfWriter

from backend.core import sellador_preview


def _a4_pdf_bytes() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=595, height=842)
    buffer = BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def test_formatos_preview_dpi_respects_requested_max_width() -> None:
    dpi = sellador_preview._resolve_preview_dpi(
        595.0,
        842.0,
        1200,
        minimum_dpi=72,
    )

    rendered_width = 595.0 * dpi / 72.0
    assert rendered_width <= 1201
    assert dpi == 145


def test_sellador_preview_keeps_default_220_dpi_floor() -> None:
    dpi = sellador_preview._resolve_preview_dpi(595.0, 842.0, 1200)

    assert dpi == sellador_preview._MIN_PREVIEW_DPI == 220


def test_formatos_preview_rounding_does_not_exceed_landscape_max_width() -> None:
    dpi = sellador_preview._resolve_preview_dpi(
        842.0,
        595.0,
        1200,
        minimum_dpi=72,
        enforce_max_width=True,
    )

    assert 842.0 * dpi / 72.0 <= 1201


def test_preview_pixel_budget_overrides_minimum_dpi() -> None:
    dpi = sellador_preview._resolve_preview_dpi(
        10_000.0,
        10_000.0,
        6144,
        minimum_dpi=72,
    )
    rendered_width = math.ceil(10_000.0 * dpi / 72.0)
    rendered_height = math.ceil(10_000.0 * dpi / 72.0)

    assert rendered_width * rendered_height <= sellador_preview._MAX_RENDER_PIXELS


def test_preview_rejects_page_when_one_dpi_exceeds_limits() -> None:
    with pytest.raises(ValueError, match="dimensiones"):
        sellador_preview._resolve_preview_dpi(
            1_000_000.0,
            1_000_000.0,
            1200,
            minimum_dpi=72,
            enforce_max_width=True,
        )


def test_formatos_max_width_overrides_minimum_dpi_for_wide_pages() -> None:
    dpi = sellador_preview._resolve_preview_dpi(
        2_000.0,
        1_000.0,
        1200,
        minimum_dpi=72,
        enforce_max_width=True,
    )

    assert 2_000.0 * dpi / 72.0 <= 1201


def test_formatos_preview_result_shape_is_unchanged() -> None:
    result = sellador_preview.render_pdf_bytes_page_preview(
        _a4_pdf_bytes(),
        1,
        max_width=1200,
        minimum_dpi=72,
        enforce_max_width=True,
    )

    assert set(result) == {
        "image_base64",
        "page_width",
        "page_height",
        "rendered_width",
        "rendered_height",
        "render_dpi",
        "mime_type",
    }
    assert result["mime_type"] == "image/png"
    assert result["image_base64"]
    assert result["page_width"] == pytest.approx(595.0)
    assert result["page_height"] == pytest.approx(842.0)
    assert result["rendered_width"] <= 1201
    assert result["render_dpi"] == 145.0


def test_formatos_preview_preserves_page_range_validation() -> None:
    with pytest.raises(ValueError, match="fuera de rango"):
        sellador_preview.render_pdf_bytes_page_preview(
            _a4_pdf_bytes(),
            2,
            max_width=1200,
            minimum_dpi=72,
            enforce_max_width=True,
        )


def test_preview_png_roundtrip_matches_raster_size() -> None:
    result = sellador_preview.render_pdf_bytes_page_preview(
        _a4_pdf_bytes(),
        1,
        max_width=1200,
    )
    image = Image.open(BytesIO(base64.b64decode(str(result["image_base64"]))))
    assert image.format == "PNG"
    assert image.size == (int(result["rendered_width"]), int(result["rendered_height"]))
    assert result["render_dpi"] == 220.0


class _CmykPixmap:
    n = 4
    alpha = 0
    width = 2
    height = 2
    stride = 8
    samples = b"\x00" * 16

    def tobytes(self, output: str = "png") -> bytes:
        assert output == "png"
        return b"\x89PNG\r\n\x1a\nfallback"


def test_pixmap_png_falls_back_for_unsupported_modes() -> None:
    encoded = sellador_preview._pixmap_to_png_bytes(_CmykPixmap())
    assert encoded == b"\x89PNG\r\n\x1a\nfallback"


def test_pixmap_png_encodes_rgb_samples() -> None:
    class _RgbPixmap:
        n = 3
        alpha = 0
        width = 2
        height = 2
        stride = 6
        samples = bytes([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0])

    encoded = sellador_preview._pixmap_to_png_bytes(_RgbPixmap())
    image = Image.open(BytesIO(encoded))
    assert image.format == "PNG"
    assert image.size == (2, 2)
    assert image.convert("RGB").getpixel((0, 0)) == (255, 0, 0)


def test_sellador_preview_jpeg_roundtrip_keeps_raster_size() -> None:
    result = sellador_preview.render_pdf_bytes_page_preview(
        _a4_pdf_bytes(),
        1,
        max_width=1200,
        image_format="jpeg",
    )
    image = Image.open(BytesIO(base64.b64decode(str(result["image_base64"]))))
    assert result["mime_type"] == "image/jpeg"
    assert image.format == "JPEG"
    assert image.size == (int(result["rendered_width"]), int(result["rendered_height"]))
    assert result["render_dpi"] == 220.0


def test_pixmap_jpeg_falls_back_to_png_for_unsupported_modes() -> None:
    payload, mime_type = sellador_preview._pixmap_to_preview_bytes(_CmykPixmap(), "jpeg")
    assert mime_type == "image/png"
    assert payload == b"\x89PNG\r\n\x1a\nfallback"
