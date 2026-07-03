"""Tests de rendering PDF y DOCX para Panel Aviso de Corte."""

from __future__ import annotations

import base64
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import pytest
from PIL import Image
from pypdf import PdfReader

from backend.core.panel_aviso_corte import (
    Panel,
    PanelImageRef,
    build_panels,
    parse_excel_bytes,
    render_docx,
    render_pdf,
)
from backend.core.panel_aviso_corte.errors import RenderingError
from backend.core.panel_aviso_corte.matcher import match_image_to_row
from backend.core.panel_aviso_corte.models import ExcelSource, MatchRule
from backend.core.panel_aviso_corte.rendering import ROW_HEIGHTS_CM, resolve_panel_template_file

_ROOT = Path(__file__).resolve().parents[2]
_W_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
_WP_NS = {"wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"}
_A_NS = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}


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


def _png_b64(width: int, height: int) -> str:
    buffer = BytesIO()
    Image.new("RGB", (width, height), "white").save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _fixture_panels_and_images() -> tuple[tuple[Panel, ...], dict[str, str]]:
    excel_path = _ROOT / "tests" / "aviso.xlsx"
    image_paths = sorted((_ROOT / "tests" / "aviso").glob("*.jpg"))
    source = parse_excel_bytes(excel_path.read_bytes(), excel_path.name)
    result = build_panels(
        source=source,
        rule=MatchRule(key_column="ID", strategy="exact"),
        image_names=[path.name for path in image_paths],
        address_column="DIRECCION",
        export_mode="skip_empty",
    )
    images = {
        path.name: base64.b64encode(path.read_bytes()).decode("ascii")
        for path in image_paths
    }
    return result.panels, images


def test_resolve_panel_template_file_maps_aviso_corte_ad() -> None:
    assert resolve_panel_template_file("aviso-corte-ad") == "panel-aviso-corte.html"
    assert resolve_panel_template_file(None) == "panel-aviso-corte.html"


def test_resolve_panel_template_file_rejects_unknown_template() -> None:
    with pytest.raises(RenderingError, match="Plantilla desconocida"):
        resolve_panel_template_file("missing-template")


def test_render_pdf_empty_panels_raises() -> None:
    with pytest.raises(RenderingError, match="No hay paneles"):
        render_pdf(panels=(), logos={}, images={}, export_mode="include_empty")


def test_render_docx_empty_panels_raises() -> None:
    with pytest.raises(RenderingError, match="No hay paneles"):
        render_docx(panels=(), logos={}, images={}, export_mode="include_empty")


def test_render_pdf_skip_empty_omits_panels_without_images() -> None:
    empty_panel = Panel(
        cuadrante="C002",
        fecha_corte="2025-06-16",
        motivo="Sin fotos",
        imagenes=(),
        source_row_index=1,
    )
    with pytest.raises(RenderingError, match="No hay paneles"):
        render_pdf(panels=(empty_panel,), logos={}, images={}, export_mode="skip_empty")


def test_render_pdf_include_empty_keeps_panels_without_images() -> None:
    empty_panel = Panel(
        cuadrante="C002",
        fecha_corte="2025-06-16",
        motivo="Sin fotos",
        imagenes=(),
        source_row_index=1,
    )
    pdf_bytes, filename = render_pdf(
        panels=(empty_panel,),
        logos={},
        images={},
        export_mode="include_empty",
    )
    assert pdf_bytes.startswith(b"%PDF")
    assert filename.endswith(".pdf")


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


def test_pdf_template_photos_fill_their_cells() -> None:
    template_path = _ROOT / "backend" / "templates" / "panel-aviso-corte.html"
    template = template_path.read_text(encoding="utf-8")

    assert ".cell-photo-inner {\n      width: 100%;\n      height: 9.82cm;" in template
    assert ".cell-photo img {\n      width: 7.36cm;\n      height: 9.82cm;" in template
    assert "object-fit: cover;" in template


def test_render_pdf_accepts_disk_backed_images(tmp_path: Path) -> None:
    panel = _make_panel()
    image_path = tmp_path / "img1.png"
    image_path.write_bytes(base64.b64decode(_tiny_png(), validate=True))

    pdf_bytes, filename = render_pdf(
        panels=(panel,),
        logos={},
        images={},
        image_paths={"img1.jpg": str(image_path)},
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


def test_render_pdf_fixture_keeps_four_images_per_page(tmp_path: Path) -> None:
    panels, images = _fixture_panels_and_images()

    pdf_bytes, _ = render_pdf(
        panels=panels,
        logos={},
        images=images,
        export_mode="include_empty",
    )

    output = tmp_path / "fixture-panel-aviso.pdf"
    output.write_bytes(pdf_bytes)
    assert [len(panel.imagenes) for panel in panels] == [4, 4]
    assert len(PdfReader(str(output)).pages) == 2


def test_render_pdf_fixture_with_square_logo_keeps_one_panel_per_page(
    tmp_path: Path,
) -> None:
    panels, images = _fixture_panels_and_images()

    pdf_bytes, _ = render_pdf(
        panels=panels,
        logos={"left": _png_b64(2000, 2000), "right": None},
        images=images,
        export_mode="include_empty",
    )

    output = tmp_path / "fixture-panel-aviso-with-logo.pdf"
    output.write_bytes(pdf_bytes)
    assert [len(panel.imagenes) for panel in panels] == [4, 4]
    assert len(PdfReader(str(output)).pages) == 2


def test_render_docx_limits_photo_height_to_image_row() -> None:
    panel = Panel(
        cuadrante="C001",
        fecha_corte="2025-06-15",
        motivo="Mantenimiento",
        imagenes=(
            PanelImageRef(filename="tall.png", caption="IMAGEN N°1: Calle 1", position=1),
        ),
        source_row_index=0,
    )

    docx_bytes, _ = render_docx(
        panels=(panel,),
        logos={},
        images={"tall.png": _png_b64(600, 2000)},
        export_mode="include_empty",
    )

    with ZipFile(BytesIO(docx_bytes)) as archive:
        document_xml = archive.read("word/document.xml")
    root = ET.fromstring(document_xml)
    extents = root.findall(".//wp:extent", _WP_NS)
    photo_heights_emu = [int(ext.attrib["cy"]) for ext in extents]
    max_photo_height_emu = round(ROW_HEIGHTS_CM["image"] * 360000)

    assert photo_heights_emu
    assert max(photo_heights_emu) <= max_photo_height_emu


def test_render_docx_applies_cover_crop_to_off_aspect_photo() -> None:
    """Una foto con aspect ratio distinto al de la celda debe recibir un srcRect
    de cover-crop en su blipFill; si no, se estira non-uniformemente al forzar
    width+height fijos en add_picture (regresión del namespace de _apply_crop)."""
    panel = Panel(
        cuadrante="C001",
        fecha_corte="2025-06-15",
        motivo="Mantenimiento",
        imagenes=(
            PanelImageRef(filename="tall.png", caption="IMAGEN N°1: Calle 1", position=1),
        ),
        source_row_index=0,
    )

    docx_bytes, _ = render_docx(
        panels=(panel,),
        logos={},
        images={"tall.png": _png_b64(600, 2000)},
        export_mode="include_empty",
    )

    with ZipFile(BytesIO(docx_bytes)) as archive:
        document_xml = archive.read("word/document.xml")
    root = ET.fromstring(document_xml)

    src_rects = root.findall(".//a:srcRect", _A_NS)
    assert src_rects, "esperaba al menos un <a:srcRect> de cover-crop sobre la foto"
    # La foto 600x2000 en celda 7.36x9.82cm -> cover scale cubre altura => sobra
    # altura => recorte por abajo (b > 0), lados intactos (l == r == 0).
    cropped = next((sr for sr in src_rects if int(sr.attrib.get("b", 0)) > 0), None)
    assert cropped is not None, "esperaba un srcRect con recorte inferior (b > 0)"
    assert cropped.attrib.get("l", "0") == "0"
    assert cropped.attrib.get("r", "0") == "0"


def test_match_image_to_row_empty_key_matches_nothing() -> None:
    """Una celda clave vacía (o sólo whitespace) no debe matchear ninguna imagen.

    Regresión de prefix/contains: ``startswith('')`` y ``'' in stem`` son siempre
    True, así que una fila con clave vacía capturaba todas las imágenes no
    asignadas y robaba fotos de filas posteriores.
    """
    for strategy in ("prefix", "contains"):
        rule = MatchRule(key_column="ID", strategy=strategy)
        assert match_image_to_row(rule, "", "1001.jpg") is False
        assert match_image_to_row(rule, "   ", "1001.jpg") is False
        # Sanity: la clave no-vacía sigue matcheando como antes.
        assert match_image_to_row(rule, "1001", "1001.jpg") is True


def test_build_panels_empty_key_row_does_not_steal_images() -> None:
    """Una fila con la columna clave vacía no debe robar la imagen de otra fila."""
    source = ExcelSource(
        filename="test.xlsx",
        columns=("ID", "DIRECCION"),
        normalized_columns=("id", "direccion"),
        rows=(
            {"ID": "", "DIRECCION": "Calle vacía"},
            {"ID": "1001", "DIRECCION": "Calle 1"},
        ),
    )
    rule = MatchRule(key_column="ID", strategy="prefix")
    result = build_panels(
        source=source,
        rule=rule,
        image_names=["1001.jpg"],
        address_column="DIRECCION",
        export_mode="skip_empty",
    )

    assert len(result.panels) == 1
    assert result.panels[0].source_row_index == 1
    assert result.panels[0].imagenes[0].filename == "1001.jpg"


def test_build_panels_overflow_images_reported_as_unmatched() -> None:
    """Las imágenes que una fila descarta por exceder MAX_IMAGES_PER_PANEL y
    ninguna fila posterior reclama deben reportarse como unmatched (no como
    matched) — de lo contrario el summary dice "matched: 5" cuando sólo 4
    imágenes aparecen en el export y la 5ta desaparece silenciosamente."""
    source = ExcelSource(
        filename="test.xlsx",
        columns=("ID", "DIRECCION"),
        normalized_columns=("id", "direccion"),
        rows=(
            {"ID": "1001", "DIRECCION": "Calle 1"},
        ),
    )
    rule = MatchRule(key_column="ID", strategy="prefix")
    images = ["1001_1.jpg", "1001_2.jpg", "1001_3.jpg", "1001_4.jpg", "1001_5.jpg"]
    result = build_panels(
        source=source,
        rule=rule,
        image_names=images,
        address_column="DIRECCION",
        export_mode="skip_empty",
    )

    panel_imgs = [ref.filename for panel in result.panels for ref in panel.imagenes]
    assert "1001_5.jpg" not in panel_imgs
    assert len(panel_imgs) == 4
    # El summary debe reflejar lo que realmente fue a paneles.
    assert result.summary.matched_images == 4
    assert result.summary.unmatched_images == 1
    assert "1001_5.jpg" in result.summary.unmatched_image_names
    assert (
        result.summary.matched_images + result.summary.unmatched_images
        == result.summary.total_images
    )


def test_build_panels_overflow_reclaimed_by_later_row_stays_matched() -> None:
    """Guard: una imagen descartada por overflow de una fila puede ser
    reclamada legítimamente por una fila posterior más específica (prefix
    jerárquico). En ese caso debe quedar en un panel y contarse como matched,
    no descartarse."""
    source = ExcelSource(
        filename="test.xlsx",
        columns=("ID", "DIRECCION"),
        normalized_columns=("id", "direccion"),
        rows=(
            {"ID": "1001", "DIRECCION": "Calle 1"},
            {"ID": "1001_5", "DIRECCION": "Calle 5"},
        ),
    )
    rule = MatchRule(key_column="ID", strategy="prefix")
    images = ["1001_1.jpg", "1001_2.jpg", "1001_3.jpg", "1001_4.jpg", "1001_5.jpg"]
    result = build_panels(
        source=source,
        rule=rule,
        image_names=images,
        address_column="DIRECCION",
        export_mode="skip_empty",
    )

    panel_imgs = [ref.filename for panel in result.panels for ref in panel.imagenes]
    assert "1001_5.jpg" in panel_imgs
    assert result.summary.matched_images == 5
    assert result.summary.unmatched_images == 0


def test_render_docx_fixture_keeps_four_images_without_internal_page_break() -> None:
    _, images = _fixture_panels_and_images()

    # Construct a panel with exactly 4 images to verify layout limits
    panel = Panel(
        cuadrante="CUADRANTE A-12",
        fecha_corte="2024-05-15",
        motivo="Trabajos de mejoramiento del reservorio R104",
        imagenes=tuple(
            PanelImageRef(filename=name, caption=f"IMAGEN N°{idx}: Test", position=idx)
            for idx, name in enumerate(sorted(images.keys())[:4], start=1)
        ),
        source_row_index=0,
    )

    docx_bytes, _ = render_docx(
        panels=(panel,),
        logos={},
        images=images,
        export_mode="include_empty",
    )

    with ZipFile(BytesIO(docx_bytes)) as archive:
        document_xml = archive.read("word/document.xml")
    root = ET.fromstring(document_xml)

    assert len(panel.imagenes) == 4
    assert len(root.findall(".//wp:extent", _WP_NS)) == 4
    assert root.findall('.//w:br[@w:type="page"]', _W_NS) == []
