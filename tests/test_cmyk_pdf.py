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


def test_hex_to_rgb_accepts_alpha():
    assert hex_to_rgb("#FF000080") == (1.0, 0.0, 0.0)
    assert hex_to_rgb("#00FF00") == (0.0, 1.0, 0.0)
    assert hex_to_rgb("#GGHHII") == (0.0, 0.0, 0.0)


def test_parse_css_named_and_rgba():
    from backend.core.cmyk_pdf.color import parse_css_color_to_rgb

    assert parse_css_color_to_rgb("orange") != (0.0, 0.0, 0.0)
    assert parse_css_color_to_rgb("orange") == (1.0, 0.647, 0.0)
    assert parse_css_color_to_rgb("rgba(255, 0, 0, 0.5)") == (1.0, 0.0, 0.0)
    assert parse_css_color_to_rgb("bogusname") == (0.0, 0.0, 0.0)


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


def test_cmyk_renderer_bbox_fallback_for_unsupported_types():
    """Clipped shapes / table / checkbox must not be silently dropped."""
    doc = create_empty_document(name="Fallback")
    for i, l_type in enumerate(("star", "table", "checkbox", "polygon", "grid")):
        doc["layers"].append(
            {
                "id": f"layer-{l_type}",
                "type": l_type,
                "name": l_type,
                "pageIndex": 0,
                "cssVars": {
                    "--width": "30mm",
                    "--height": "20mm",
                    "--translate-x": f"{10 + i * 35}mm",
                    "--translate-y": "40mm",
                    "--background-color": "#00AA00",
                    "--border-color": "#000000",
                    "--border-width": "0.5mm",
                },
            }
        )
    # Group is chrome-only — must not crash.
    doc["layers"].append(
        {
            "id": "layer-group",
            "type": "group",
            "name": "Grupo",
            "pageIndex": 0,
            "cssVars": {
                "--width": "10mm",
                "--height": "10mm",
                "--translate-x": "0mm",
                "--translate-y": "0mm",
            },
        }
    )

    pdf_bytes = CanvasCmykRenderer(document=doc).render()
    assert pdf_bytes.startswith(b"%PDF")
    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    assert len(pdf_doc) == 1
    # Drawings present beyond an empty page (fallback rects were painted).
    assert len(pdf_doc[0].get_drawings()) > 0
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
    assert "saved_path" not in res
    decoded = base64.b64decode(res["pdf_base64"])
    assert decoded.startswith(b"%PDF")


def test_canvas_export_cmyk_pdf_writes_to_output_path_without_base64(tmp_path):
    doc = create_empty_document(name="IPC Disk Doc")
    output_path = tmp_path / "canvas_out.pdf"
    res = canvas_export_cmyk_pdf(
        {
            "document": doc,
            "color_profile": "cmyk_iso_coated_v2",
            "bleed_mm": 3.0,
            "show_crop_marks": True,
            "outputPath": str(output_path),
            "filename": "ignored_when_path_set.pdf",
        }
    )

    assert res["saved_path"] == str(output_path)
    assert res["filename"] == "canvas_out.pdf"
    assert "pdf_base64" not in res
    assert output_path.exists()
    assert output_path.read_bytes().startswith(b"%PDF")


def _page0_contents(pdf_bytes: bytes) -> bytes:
    """Raw content stream of page 0 (drawing order = byte order in PDF)."""
    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = pdf_doc[0]
        raw = b""
        # PyMuPDF: get_contents() → xrefs; xref_stream → bytes.
        # Pattern for a filled rect is `re f` (confirmed on PyMuPDF 1.x).
        for xref in page.get_contents():
            raw += pdf_doc.xref_stream(xref)
        return raw
    finally:
        pdf_doc.close()


def test_cmyk_renderer_z_order_background_does_not_cover_text():
    """Rect fill must precede text in the stream so the text paints on top.

    Today this fails: shapes commit after insert_textbox, so the fill covers
    the text. Plans 003/004 make this green.
    """
    doc = create_empty_document(name="Z-order")
    doc["layers"] = [
        {
            "id": "layer-bg",
            "type": "rect",
            "name": "Fondo",
            "pageIndex": 0,
            "cssVars": {
                "--width": "100mm",
                "--height": "100mm",
                "--translate-x": "10mm",
                "--translate-y": "10mm",
                "--background-color": "#000000",
            },
        },
        {
            "id": "layer-text",
            "type": "text",
            "name": "Texto",
            "value": "HOLA",
            "pageIndex": 0,
            "cssVars": {
                "--width": "80mm",
                "--height": "20mm",
                "--translate-x": "20mm",
                "--translate-y": "20mm",
                "--color": "#FFFFFF",
                "--font-size": "14pt",
            },
        },
    ]

    raw = _page0_contents(CanvasCmykRenderer(document=doc).render())
    text_at = raw.find(b"HOLA")
    # `re f` = rectangle path + fill (PyMuPDF Shape.commit output).
    fill_at = raw.rfind(b"re f")
    assert text_at >= 0, "text HOLA missing from content stream"
    assert fill_at >= 0, "rect fill operator missing from content stream"
    # Later content paints on top: fill must appear BEFORE text.
    assert fill_at < text_at, (
        f"z-order inverted: fill at {fill_at}, text at {text_at} "
        "(background would cover text)"
    )


def test_cmyk_renderer_z_order_text_below_rect():
    """When text is below a rect in layer order, fill must paint after text."""
    doc = create_empty_document(name="Z-order inverse")
    doc["layers"] = [
        {
            "id": "layer-text",
            "type": "text",
            "name": "Texto",
            "value": "HOLA",
            "pageIndex": 0,
            "cssVars": {
                "--width": "80mm",
                "--height": "20mm",
                "--translate-x": "20mm",
                "--translate-y": "20mm",
                "--color": "#FFFFFF",
                "--font-size": "14pt",
            },
        },
        {
            "id": "layer-fg",
            "type": "rect",
            "name": "Cubre",
            "pageIndex": 0,
            "cssVars": {
                "--width": "100mm",
                "--height": "100mm",
                "--translate-x": "10mm",
                "--translate-y": "10mm",
                "--background-color": "#000000",
            },
        },
    ]

    raw = _page0_contents(CanvasCmykRenderer(document=doc).render())
    text_at = raw.find(b"HOLA")
    fill_at = raw.rfind(b"re f")
    assert text_at >= 0 and fill_at >= 0
    assert text_at < fill_at, (
        f"expected text under rect: text at {text_at}, fill at {fill_at}"
    )


def test_cmyk_renderer_resolves_runtime_content_from_context():
    """CMYK export must fill {{key}}, field meta.key, and imageSlot from ctx.

    Today fails: renderer only reads ctx['values'] and layer.value.
    Plan 003 makes this green.
    """
    import os
    import tempfile

    from PIL import Image

    png_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            png_path = tmp.name
            Image.new("RGB", (10, 10), color=(255, 0, 0)).save(png_path)

        doc = create_empty_document(name="Runtime content")
        doc["layers"] = [
            {
                "id": "layer-nombre",
                "type": "text",
                "name": "Nombre",
                "value": "{{nombre}}",
                "pageIndex": 0,
                "cssVars": {
                    "--width": "80mm",
                    "--height": "15mm",
                    "--translate-x": "10mm",
                    "--translate-y": "10mm",
                    "--color": "#000000",
                    "--font-size": "12pt",
                },
            },
            {
                "id": "layer-tel",
                "type": "field",
                "name": "Teléfono",
                "value": "",
                "pageIndex": 0,
                "meta": {"key": "telefono"},
                "cssVars": {
                    "--width": "80mm",
                    "--height": "15mm",
                    "--translate-x": "10mm",
                    "--translate-y": "30mm",
                    "--color": "#000000",
                    "--font-size": "12pt",
                },
            },
            {
                "id": "layer-foto",
                "type": "imageSlot",
                "name": "Foto",
                "value": "",
                "pageIndex": 0,
                "meta": {"index": 0},
                "cssVars": {
                    "--width": "40mm",
                    "--height": "40mm",
                    "--translate-x": "10mm",
                    "--translate-y": "50mm",
                },
            },
        ]

        ctx = {
            "data": {"nombre": "Juan", "telefono": "555-1234"},
            "images": [png_path],
            "logoLeft": "",
            "logoRight": "",
        }
        pdf_bytes = CanvasCmykRenderer(
            document=doc,
            contexts=[ctx],
        ).render(local_image_paths={png_path: png_path})

        pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            page = pdf_doc[0]
            text = page.get_text()
            assert "Juan" in text
            assert "555-1234" in text
            assert page.get_images(), "imageSlot should embed an image from ctx"
        finally:
            pdf_doc.close()
    finally:
        if png_path and os.path.exists(png_path):
            os.unlink(png_path)


def test_cmyk_renderer_multiple_contexts_and_pages():
    """N contexts x M pages -> N*M PDF pages with per-context substitution."""
    doc = create_empty_document(name="Multi")
    doc["pages"] = [
        {"id": "page-1", "name": "Página 1"},
        {"id": "page-2", "name": "Página 2"},
    ]
    doc["layers"] = [
        {
            "id": "layer-v",
            "type": "text",
            "name": "Valor",
            "value": "{{v}}",
            "pageIndex": 0,
            "cssVars": {
                "--width": "80mm",
                "--height": "15mm",
                "--translate-x": "10mm",
                "--translate-y": "10mm",
                "--color": "#000000",
                "--font-size": "12pt",
            },
        },
    ]

    pdf_bytes = CanvasCmykRenderer(
        document=doc,
        contexts=[{"data": {"v": "A"}}, {"data": {"v": "B"}}],
    ).render()

    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        assert len(pdf_doc) == 4  # 2 contexts x 2 pages
        # Text layer is only on pageIndex 0 -> odd pages (1, 3) stay empty.
        assert "A" in pdf_doc[0].get_text()
        assert "B" in pdf_doc[2].get_text()
    finally:
        pdf_doc.close()


def test_cmyk_renderer_pair_context_pages():
    """pair_context_pages=True pairs context[i] with page i (no cartesian product)."""
    doc = create_empty_document(name="Paired")
    doc["pages"] = [
        {"id": "page-1", "name": "Página 1"},
        {"id": "page-2", "name": "Página 2"},
        {"id": "page-3", "name": "Página 3"},
    ]
    doc["layers"] = [
        {
            "id": "layer-a",
            "type": "text",
            "name": "A",
            "value": "{{v}}",
            "pageIndex": 0,
            "cssVars": {
                "--width": "80mm",
                "--height": "15mm",
                "--translate-x": "10mm",
                "--translate-y": "10mm",
                "--color": "#000000",
                "--font-size": "12pt",
            },
        },
        {
            "id": "layer-b",
            "type": "text",
            "name": "B",
            "value": "{{v}}",
            "pageIndex": 1,
            "cssVars": {
                "--width": "80mm",
                "--height": "15mm",
                "--translate-x": "10mm",
                "--translate-y": "10mm",
                "--color": "#000000",
                "--font-size": "12pt",
            },
        },
        {
            "id": "layer-c",
            "type": "text",
            "name": "C",
            "value": "{{v}}",
            "pageIndex": 2,
            "cssVars": {
                "--width": "80mm",
                "--height": "15mm",
                "--translate-x": "10mm",
                "--translate-y": "10mm",
                "--color": "#000000",
                "--font-size": "12pt",
            },
        },
    ]

    pdf_bytes = CanvasCmykRenderer(
        document=doc,
        contexts=[
            {"data": {"v": "ONE"}},
            {"data": {"v": "TWO"}},
            {"data": {"v": "THREE"}},
        ],
        pair_context_pages=True,
    ).render()

    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        assert len(pdf_doc) == 3  # paired, not 3x3=9
        assert "ONE" in pdf_doc[0].get_text()
        assert "TWO" in pdf_doc[1].get_text()
        assert "THREE" in pdf_doc[2].get_text()
    finally:
        pdf_doc.close()


def test_cmyk_renderer_rotated_rect():
    """Rotated rect draws a quad path instead of a plain axis-aligned fill."""
    doc = create_empty_document(name="Rotate rect")
    doc["layers"] = [
        {
            "id": "layer-rot",
            "type": "rect",
            "name": "Rotado",
            "pageIndex": 0,
            "cssVars": {
                "--width": "40mm",
                "--height": "20mm",
                "--translate-x": "20mm",
                "--translate-y": "20mm",
                "--rotate": "45deg",
                "--background-color": "#FF0000",
            },
        }
    ]

    raw = _page0_contents(CanvasCmykRenderer(document=doc).render())
    assert b" re f" not in raw


def test_cmyk_renderer_rotated_text_90():
    doc = create_empty_document(name="Rotate text")
    doc["layers"] = [
        {
            "id": "layer-text",
            "type": "text",
            "name": "Girado",
            "value": "ROTATE90",
            "pageIndex": 0,
            "cssVars": {
                "--width": "60mm",
                "--height": "20mm",
                "--translate-x": "20mm",
                "--translate-y": "40mm",
                "--rotate": "90deg",
                "--color": "#000000",
                "--font-size": "12pt",
            },
        }
    ]

    pdf_bytes = CanvasCmykRenderer(document=doc).render()
    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        assert "ROTATE9" in pdf_doc[0].get_text()
    finally:
        pdf_doc.close()


def test_cmyk_renderer_image_object_fit_cover():
    import os
    import tempfile

    from PIL import Image

    png_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            png_path = tmp.name
            Image.new("RGB", (20, 10), color=(0, 128, 255)).save(png_path)

        doc = create_empty_document(name="Object fit")
        doc["layers"] = [
            {
                "id": "layer-img",
                "type": "image",
                "name": "Foto",
                "value": png_path,
                "pageIndex": 0,
                "cssVars": {
                    "--width": "100mm",
                    "--height": "50mm",
                    "--translate-x": "10mm",
                    "--translate-y": "10mm",
                    "--object-fit": "cover",
                },
            }
        ]

        pdf_bytes = CanvasCmykRenderer(document=doc).render(local_image_paths={png_path: png_path})
        pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            page = pdf_doc[0]
            images = page.get_images()
            assert images, "cover object-fit should embed an image"
        finally:
            pdf_doc.close()
    finally:
        if png_path and os.path.exists(png_path):
            os.unlink(png_path)


def test_cmyk_renderer_text_align_and_font():
    doc = create_empty_document(name="Align font")
    doc["layers"] = [
        {
            "id": "layer-text",
            "type": "text",
            "name": "Centrado",
            "value": "CENTERFONT",
            "pageIndex": 0,
            "cssVars": {
                "--width": "80mm",
                "--height": "20mm",
                "--translate-x": "20mm",
                "--translate-y": "30mm",
                "--text-align": "center",
                "--font-family": "Times New Roman",
                "--color": "#000000",
                "--font-size": "12pt",
            },
        }
    ]

    pdf_bytes = CanvasCmykRenderer(document=doc).render()
    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        assert "CENTERFONT" in pdf_doc[0].get_text()
    finally:
        pdf_doc.close()
