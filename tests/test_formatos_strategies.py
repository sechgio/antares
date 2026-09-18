from __future__ import annotations

import io

from pypdf import PdfReader, PdfWriter

from backend.core.format_strategies import get_strategy


def _minimal_pdf_bytes() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def test_simple_overlay_generate_page_count() -> None:
    strategy = get_strategy("simple_overlay")
    template = _minimal_pdf_bytes()
    pdf_bytes = strategy.generate(template, 1, 2, mapping=None)
    assert pdf_bytes.startswith(b"%PDF")
    reader = PdfReader(io.BytesIO(pdf_bytes))
    assert len(reader.pages) == 2


def test_legacy_xobject_rejects_blank_template() -> None:
    strategy = get_strategy("legacy_xobject")
    template = _minimal_pdf_bytes()
    try:
        strategy.generate(template, 5, 6, mapping=None)
        raise AssertionError("expected ValueError for blank template")
    except ValueError as exc:
        assert "xobject" in str(exc).lower()


def test_visual_overlay_requires_mapping() -> None:
    strategy = get_strategy("visual_overlay")
    template = _minimal_pdf_bytes()
    try:
        strategy.generate(template, 1, 1, mapping=None)
        raise AssertionError("expected ValueError for missing mapping")
    except ValueError as exc:
        assert "mapping" in str(exc).lower()


def _visual_mapping(**overrides):
    mapping = {
        "page": 0,
        "x": 50,
        "y": 30,
        "width": 100,
        "height": 20,
        "font_size": 12,
        "font_name": "Helvetica-Bold",
        "color_r": 0.1,
        "color_g": 0.2,
        "color_b": 0.5,
        "padding": 7,
        "blank_x": None,
        "blank_y": None,
        "blank_width": None,
        "blank_height": None,
        "redraw_top_border": False,
        "redraw_ot_badge": False,
        "blank_mcids": None,
    }
    mapping.update(overrides)
    return mapping


def _bundled_template(name: str) -> bytes:
    import base64
    from pathlib import Path

    b64 = Path(__file__).resolve().parent.parent / "formatos" / f"{name}.b64"
    return base64.b64decode(b64.read_text(encoding="ascii").strip())


def test_visual_overlay_generate_stamps_each_page() -> None:
    strategy = get_strategy("visual_overlay")
    pdf_bytes = strategy.generate(_minimal_pdf_bytes(), 1, 3, mapping=_visual_mapping())
    reader = PdfReader(io.BytesIO(pdf_bytes))
    assert len(reader.pages) == 3
    text = reader.pages[0].extract_text()
    assert "0000001" in (text or "")


def test_visual_overlay_blank_rect_with_ot_badge() -> None:
    strategy = get_strategy("visual_overlay")
    mapping = _visual_mapping(
        blank_x=40,
        blank_y=25,
        blank_width=120,
        blank_height=22,
        redraw_ot_badge=True,
    )
    pdf_bytes = strategy.generate(_minimal_pdf_bytes(), 7, 7, mapping=mapping)
    reader = PdfReader(io.BytesIO(pdf_bytes))
    assert len(reader.pages) == 1
    assert "0000007" in (reader.pages[0].extract_text() or "")


def test_visual_overlay_blank_rect_with_top_border() -> None:
    strategy = get_strategy("visual_overlay")
    mapping = _visual_mapping(
        blank_x=40,
        blank_y=25,
        blank_width=120,
        blank_height=22,
        redraw_top_border=True,
    )
    pdf_bytes = strategy.generate(_minimal_pdf_bytes(), 9, 9, mapping=mapping)
    reader = PdfReader(io.BytesIO(pdf_bytes))
    assert len(reader.pages) == 1


def test_visual_overlay_blank_mcids_en_template_real() -> None:
    strategy = get_strategy("visual_overlay")
    mapping = _visual_mapping(blank_mcids=[63])
    pdf_bytes = strategy.generate(_bundled_template("template-d"), 1, 1, mapping=mapping)
    reader = PdfReader(io.BytesIO(pdf_bytes))
    assert len(reader.pages) == 1


def test_legacy_xobject_generate_con_template_bundled() -> None:
    strategy = get_strategy("legacy_xobject")
    pdf_bytes = strategy.generate(_bundled_template("template-d"), 42, 43, mapping=None)
    reader = PdfReader(io.BytesIO(pdf_bytes))
    assert len(reader.pages) == 2
    # el XObject del correlativo se reemplazó por el número padded
    xobjects = reader.pages[0]["/Resources"].get("/XObject")
    assert xobjects is not None
    blobs = [
        ref.get_object().get_data()
        for ref in xobjects.get_object().values()
        if ref.get_object().get("/Subtype") == "/Form"
    ]
    assert any(b"0000042" in blob for blob in blobs)
