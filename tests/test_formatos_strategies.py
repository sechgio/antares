"""Characterization tests for real format PDF strategies (no generate_pdf mock)."""

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
    """Blank PDFs lack XObjects — strategy must fail closed (current behavior)."""
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
