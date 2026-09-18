
from __future__ import annotations

import base64
from pathlib import Path

import fitz

_PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def _write(doc: fitz.Document, path: Path) -> None:
    try:
        doc.save(path)
    finally:
        doc.close()


def _text_shapes(path: Path) -> None:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), "Texto estándar", fontsize=12)
    page.draw_rect(fitz.Rect(72, 100, 192, 140), color=(0, 0, 0), fill=(1, 1, 1))
    page.draw_oval(fitz.Rect(220, 100, 260, 140), color=(0, 0, 0))
    page.draw_line(fitz.Point(72, 170), fitz.Point(192, 170), color=(0, 0, 0))
    widget = fitz.Widget()
    widget.field_name = "agree"
    widget.field_type = fitz.PDF_WIDGET_TYPE_CHECKBOX
    widget.rect = fitz.Rect(72, 190, 84, 202)
    widget.field_value = True
    page.add_widget(widget)
    _write(doc, path)


def _image_scan(path: Path) -> None:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_image(fitz.Rect(0, 0, 612, 792), stream=_PNG_1X1)
    _write(doc, path)


def _multi_page(path: Path) -> None:
    doc = fitz.open()
    for page_number in range(3):
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 72), f"Página {page_number + 1}", fontsize=12)
    _write(doc, path)


def _mixed_sizes(path: Path) -> None:
    doc = fitz.open()
    doc.new_page(width=612, height=792)
    doc.new_page(width=792, height=612)
    _write(doc, path)


def test_generate_canvas_pdf_fixtures(tmp_path: Path) -> None:
    fixtures = {
        "text-shapes.pdf": _text_shapes,
        "image-scan.pdf": _image_scan,
        "multi-page.pdf": _multi_page,
        "mixed-sizes.pdf": _mixed_sizes,
    }
    for filename, generator in fixtures.items():
        generator(tmp_path / filename)

    text_shapes = fitz.open(tmp_path / "text-shapes.pdf")
    try:
        assert len(text_shapes) == 1
        assert "Texto estándar" in text_shapes[0].get_text()
        assert text_shapes.embfile_names() == []
    finally:
        text_shapes.close()

    scan = fitz.open(tmp_path / "image-scan.pdf")
    try:
        assert len(scan) == 1
        assert len(scan[0].get_images(full=True)) == 1
    finally:
        scan.close()

    multi_page = fitz.open(tmp_path / "multi-page.pdf")
    try:
        assert len(multi_page) == 3
    finally:
        multi_page.close()

    mixed = fitz.open(tmp_path / "mixed-sizes.pdf")
    try:
        assert mixed[0].rect.width != mixed[1].rect.width
    finally:
        mixed.close()
