"""Tests de rendering PDF y DOCX para Panel Aviso de Corte."""

from __future__ import annotations

import pytest

from backend.core.panel_aviso_corte import Panel, PanelImageRef, render_docx, render_pdf
from backend.core.panel_aviso_corte.errors import RenderingError


def _tiny_png() -> str:
    """Devuelve una imagen PNG válida de 1x1 píxel codificada en base64."""
    return (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )


def _make_panel() -> Panel:
    return Panel(
        cuadrante="C001",
        fecha_corte="2025-06-15",
        motivo="Mantenimiento",
        imagenes=(
            PanelImageRef(filename="img1.jpg", caption="IMAGEN N°1: Calle 1", position=1),
            PanelImageRef(filename="img2.jpg", caption="IMAGEN N°2: Calle 2", position=2),
        ),
        source_row_index=0,
    )


def test_render_pdf_empty_panels_raises() -> None:
    with pytest.raises(RenderingError, match="No hay paneles"):
        render_pdf(panels=(), logos={}, images={}, export_mode="include_empty")


def test_render_docx_empty_panels_raises() -> None:
    with pytest.raises(RenderingError, match="No hay paneles"):
        render_docx(panels=(), logos={}, images={}, export_mode="include_empty")


def test_render_pdf_success() -> None:
    panel = _make_panel()
    images = {"img1.jpg": _tiny_png(), "img2.jpg": _tiny_png()}
    pdf_bytes, filename = render_pdf(
        panels=(panel,),
        logos={},
        images=images,
        export_mode="include_empty",
    )
    assert pdf_bytes.startswith(b"%PDF")
    assert filename.endswith(".pdf")


def test_render_docx_success() -> None:
    panel = _make_panel()
    images = {"img1.jpg": _tiny_png(), "img2.jpg": _tiny_png()}
    docx_bytes, filename = render_docx(
        panels=(panel,),
        logos={},
        images=images,
        export_mode="include_empty",
    )
    # Magic number ZIP / DOCX
    assert docx_bytes[:4] == b"PK\x03\x04"
    assert filename.endswith(".docx")


def test_render_docx_with_logo() -> None:
    panel = _make_panel()
    images = {"img1.jpg": _tiny_png()}
    logos = {"left": _tiny_png(), "right": None}
    docx_bytes, filename = render_docx(
        panels=(panel,),
        logos=logos,
        images=images,
        export_mode="include_empty",
    )
    assert docx_bytes[:4] == b"PK\x03\x04"
    assert filename.endswith(".docx")


def test_render_docx_multiple_panels() -> None:
    p1 = _make_panel()
    p2 = Panel(
        cuadrante="C002",
        fecha_corte="2025-06-16",
        motivo="Reparación",
        imagenes=(),
        source_row_index=1,
    )
    images = {"img1.jpg": _tiny_png(), "img2.jpg": _tiny_png()}
    docx_bytes, filename = render_docx(
        panels=(p1, p2),
        logos={},
        images=images,
        export_mode="include_empty",
    )
    assert docx_bytes[:4] == b"PK\x03\x04"
    assert filename.endswith(".docx")
