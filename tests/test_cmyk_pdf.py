"""Tests for CMYK PDF Rendering and Color Conversion Subsystem."""

from __future__ import annotations

import base64

import fitz

from backend.core.canvas.models import create_empty_document
from backend.core.cmyk_pdf import (
    CanvasCmykRenderer,
    convert_pdf_bytes_to_cmyk,
    css_color_to_cmyk,
    hex_to_rgb,
    rgb_to_cmyk,
)
from backend.handlers.canvas import canvas_export_cmyk_pdf


def test_hex_to_rgb():
    assert hex_to_rgb("#FF0000") == (1.0, 0.0, 0.0)
    assert hex_to_rgb("#00FF00") == (0.0, 1.0, 0.0)
    assert hex_to_rgb("#0000FF") == (0.0, 0.0, 1.0)
    assert hex_to_rgb("#FFF") == (1.0, 1.0, 1.0)
    assert hex_to_rgb("invalid") == (0.0, 0.0, 0.0)


def test_rgb_to_cmyk():
    assert rgb_to_cmyk(1.0, 0.0, 0.0) == (0.0, 1.0, 1.0, 0.0)  # Pure Red
    assert rgb_to_cmyk(0.0, 1.0, 0.0) == (1.0, 0.0, 1.0, 0.0)  # Pure Green
    assert rgb_to_cmyk(0.0, 0.0, 1.0) == (1.0, 1.0, 0.0, 0.0)  # Pure Blue
    assert rgb_to_cmyk(0.0, 0.0, 0.0) == (0.0, 0.0, 0.0, 1.0)  # Pure Black
    assert rgb_to_cmyk(1.0, 1.0, 1.0) == (0.0, 0.0, 0.0, 0.0)  # Pure White


def test_css_color_to_cmyk():
    cmyk_red = css_color_to_cmyk("#FF0000")
    assert cmyk_red == (0.0, 1.0, 1.0, 0.0)

    cmyk_rgb = css_color_to_cmyk("rgb(255, 0, 0)")
    assert cmyk_rgb == (0.0, 1.0, 1.0, 0.0)


def test_canvas_cmyk_renderer():
    doc = create_empty_document(name="Test Document")
    doc["layers"].append(
        {
            "id": "layer-rect",
            "type": "rect",
            "name": "Rectángulo Imprenta",
            "pageIndex": 0,
            "cssVars": {
                "--width": "100mm",
                "--height": "50mm",
                "--translate-x": "10mm",
                "--translate-y": "10mm",
                "--background-color": "#FF0000",
                "--border-color": "#000000",
                "--border-width": "1mm",
            },
        }
    )
    doc["layers"].append(
        {
            "id": "layer-text",
            "type": "text",
            "name": "Texto Imprenta",
            "value": "Hola Imprenta CMYK",
            "pageIndex": 0,
            "cssVars": {
                "--width": "80mm",
                "--height": "20mm",
                "--translate-x": "20mm",
                "--translate-y": "70mm",
                "--color": "#0000FF",
                "--font-size": "14pt",
            },
        }
    )

    renderer = CanvasCmykRenderer(document=doc, bleed_mm=3.0, show_crop_marks=True)
    pdf_bytes = renderer.render()

    assert pdf_bytes.startswith(b"%PDF")
    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    assert len(pdf_doc) == 1

    page = pdf_doc[0]

    # MediaBox should be larger than A4 (210mm x 297mm) due to 3mm bleed + 10mm crop margin
    # 210mm + 2*(3+10) = 236mm = ~668.97pt
    # 297mm + 2*(3+10) = 323mm = ~915.59pt
    assert page.rect.width > 210 * 72.0 / 25.4
    assert page.rect.height > 297 * 72.0 / 25.4

    pdf_doc.close()


def test_convert_pdf_bytes_to_cmyk():
    doc = create_empty_document(name="Basic Doc")
    renderer = CanvasCmykRenderer(document=doc)
    original_pdf = renderer.render()

    cmyk_pdf = convert_pdf_bytes_to_cmyk(original_pdf, dpi=150)
    assert cmyk_pdf.startswith(b"%PDF")


def test_canvas_export_cmyk_pdf_handler():
    doc = create_empty_document(name="IPC Test Doc")
    res = canvas_export_cmyk_pdf(
        {
            "document": doc,
            "color_profile": "cmyk_iso_coated_v2",
            "bleed_mm": 3.0,
            "show_crop_marks": True,
        }
    )

    assert "pdf_base64" in res
    assert "filename" in res
    decoded = base64.b64decode(res["pdf_base64"])
    assert decoded.startswith(b"%PDF")
