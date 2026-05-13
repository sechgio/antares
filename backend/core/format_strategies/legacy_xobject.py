"""Legacy XObject strategy for PDF correlative number generation."""
from __future__ import annotations

import io
import logging
from typing import Any

from pypdf import PdfReader, PdfWriter
from pypdf.generic import DictionaryObject, IndirectObject, NameObject, create_string_object

from backend.core.format_strategies.shared import _escape_pdf_text

logger = logging.getLogger(__name__)

_NUMBER_XOBJECT_DRAW_COUNT = 7
_NUMBER_XOBJECT_MARKERS = (
    b"3.7440772 0 0 3.7440772",
    b"1 0 0 rg",
    b"/H2 <</MCID 93 >> BDC",
)
_NUMBER_FONT_NAME = "/FZD"
_NUMBER_FONT_SIZE = 10.6599998
_TEMPLATE_NUMBER_TEXT = "0000001"


def _find_number_xobject(page) -> Any:
    xobjects = page["/Resources"].get("/XObject")
    if xobjects is None:
        msg = "Template sin XObjects"
        raise ValueError(msg)
    for ref in xobjects.get_object().values():
        xobject = ref.get_object()
        if xobject.get("/Subtype") != "/Form":
            continue
        data = xobject.get_data()
        if data.count(b"Tj") != _NUMBER_XOBJECT_DRAW_COUNT:
            continue
        if all(marker in data for marker in _NUMBER_XOBJECT_MARKERS):
            return xobject
    msg = "No se encontro el XObject del correlativo en el template"
    raise ValueError(msg)


def _ensure_number_font(xobject) -> None:
    resources = xobject["/Resources"].get_object()
    fonts = resources["/Font"].get_object()
    font_name = NameObject(_NUMBER_FONT_NAME)
    if font_name in fonts:
        return
    fonts[font_name] = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Courier-Bold"),
        NameObject("/Encoding"): NameObject("/WinAnsiEncoding"),
    })


def _update_number_xobject(page, padded_number: str) -> None:
    from pypdf.generic import ArrayObject, NumberObject
    xobject = _find_number_xobject(page)
    _ensure_number_font(xobject)
    xobject[NameObject("/BBox")] = ArrayObject([
        NumberObject(0), NumberObject(0), NumberObject(200), NumberObject(42),
    ])
    escaped = _escape_pdf_text(padded_number)
    xobject.set_data((
        "q\n"
        "3.7440772 0 0 3.7440772 .135864258 -3.3921204 cm\n"
        "1 0 0 RG\n"
        "1 0 0 rg\n"
        "/G3 gs\n"
        "/H2 <</MCID 93 >> BDC\n"
        "/NonStruct <<>> BDC\n"
        "BT\n"
        f"{_NUMBER_FONT_NAME} {_NUMBER_FONT_SIZE} Tf\n"
        "-0.98 Tc\n"
        "1 0 0 -1 0 9 Tm\n"
        f"({escaped}) Tj\n"
        "ET\n"
        "Q\n"
        "EMC\n"
        "EMC\n"
    ).encode("latin-1"))


def _update_accessible_number(reader: PdfReader, padded_number: str) -> None:
    for object_number in sorted(reader.xref.get(0, {}).keys()):
        obj = reader.get_object(IndirectObject(object_number, 0, reader))
        if not hasattr(obj, "get"):
            continue
        if obj.get("/T") == _TEMPLATE_NUMBER_TEXT or obj.get("/E") == _TEMPLATE_NUMBER_TEXT:
            obj[NameObject("/T")] = create_string_object(padded_number)
            obj[NameObject("/E")] = create_string_object(padded_number)
            return
    logger.warning("No se encontro metadata accesible para el correlativo")


class LegacyXObjectStrategy:
    def generate(self, template_bytes: bytes, desde: int, hasta: int, mapping: dict[str, Any] | None = None) -> bytes:
        writer = PdfWriter()
        for number in range(desde, hasta + 1):
            reader = PdfReader(io.BytesIO(template_bytes))
            page = reader.pages[0]
            padded = str(number).zfill(7)
            _update_number_xobject(page, padded)
            _update_accessible_number(reader, padded)
            writer.add_page(page)
        buffer = io.BytesIO()
        writer.write(buffer)
        return buffer.getvalue()
