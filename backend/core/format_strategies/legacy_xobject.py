from __future__ import annotations

import io
from typing import Any, cast

from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    DecodedStreamObject,
    DictionaryObject,
    IndirectObject,
    NameObject,
    NumberObject,
)

from backend.core.format_strategies.shared import _clone_page_shallow, _escape_pdf_text

_NUMBER_XOBJECT_DRAW_COUNT = 7
_NUMBER_XOBJECT_MARKERS = (
    b"3.7440772 0 0 3.7440772",
    b"1 0 0 rg",
    b"/H2 <</MCID 93 >> BDC",
)
_NUMBER_FONT_NAME = "/FZD"
_NUMBER_FONT_SIZE = 10.6599998


def _find_number_xobject(page) -> tuple[str, Any]:
    xobjects = page["/Resources"].get("/XObject")
    if xobjects is None:
        msg = "Template sin XObjects"
        raise ValueError(msg)
    for name, ref in xobjects.get_object().items():
        xobject = ref.get_object()
        if xobject.get("/Subtype") != "/Form":
            continue
        data = xobject.get_data()
        if data.count(b"Tj") != _NUMBER_XOBJECT_DRAW_COUNT:
            continue
        if all(marker in data for marker in _NUMBER_XOBJECT_MARKERS):
            return name, xobject
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


def _number_xobject_data(padded_number: str) -> bytes:
    escaped = _escape_pdf_text(padded_number)
    return (
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
    ).encode("latin-1")


def _build_number_xobject(writer: PdfWriter, template_xobject, padded_number: str) -> IndirectObject:
    stream = DecodedStreamObject()
    stream.set_data(_number_xobject_data(padded_number))
    stream[NameObject("/Type")] = NameObject("/XObject")
    stream[NameObject("/Subtype")] = NameObject("/Form")
    stream[NameObject("/BBox")] = ArrayObject([
        NumberObject(0), NumberObject(0), NumberObject(200), NumberObject(42),
    ])
    if "/Matrix" in template_xobject:
        stream[NameObject("/Matrix")] = template_xobject["/Matrix"]
    stream[NameObject("/Resources")] = template_xobject["/Resources"]
    return writer._add_object(stream)


class LegacyXObjectStrategy:
    def generate(self, template_bytes: bytes, desde: int, hasta: int, mapping: dict[str, Any] | None = None) -> bytes:
        writer = PdfWriter()
        reader = PdfReader(io.BytesIO(template_bytes))
        base_page = writer.add_page(reader.pages[0])
        _, template_xobject = _find_number_xobject(base_page)
        _ensure_number_font(template_xobject)
        shared_resources = cast(DictionaryObject, base_page["/Resources"])
        shared_xobjects = cast(DictionaryObject, shared_resources["/XObject"].get_object())
        number_names = [
            name for name, ref in shared_xobjects.items() if ref.get_object() is template_xobject
        ]
        for number in range(desde, hasta + 1):
            padded = str(number).zfill(7)
            page = base_page if number == desde else _clone_page_shallow(writer, base_page)
            resources = cast(DictionaryObject, page["/Resources"])
            if resources is shared_resources:
                resources = DictionaryObject(shared_resources)
                page[NameObject("/Resources")] = resources
            xobjects = DictionaryObject(shared_xobjects)
            number_xobject = _build_number_xobject(writer, template_xobject, padded)
            for name in number_names:
                xobjects[NameObject(name)] = number_xobject
            resources[NameObject("/XObject")] = xobjects
        buffer = io.BytesIO()
        writer.write(buffer)
        return buffer.getvalue()
