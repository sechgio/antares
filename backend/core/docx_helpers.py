"""Low-level python-docx layout helpers shared by document renderers.

python-docx is imported lazily inside each helper so importing this module
never pulls the heavy dependency at process start.
"""

from __future__ import annotations

from typing import Any


def cm_to_twips(value: float) -> int:
    return round(value * 567)


def pt_to_twips(value: float) -> int:
    return round(value * 20)


def set_normal_font(doc: Any, font_name: str) -> None:
    from docx.oxml.ns import qn

    doc.styles["Normal"].font.name = font_name
    doc.styles["Normal"]._element.rPr.rFonts.set(qn("w:eastAsia"), font_name)


def set_row_height(row: Any, height_cm: float, *, rule: str = "exact") -> None:
    from docx.oxml import parse_xml
    from docx.oxml.ns import qn

    trPr = row._tr.get_or_add_trPr()
    for node in trPr.findall(qn("w:trHeight")):
        trPr.remove(node)
    trPr.append(parse_xml(
        '<w:trHeight xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        f'w:val="{cm_to_twips(height_cm)}" w:hRule="{rule}"/>',
    ))


def set_cell_width(cell: Any, width_cm: float) -> None:
    from docx.oxml import parse_xml
    from docx.oxml.ns import qn

    tcPr = cell._tc.get_or_add_tcPr()
    for old in tcPr.findall(qn("w:tcW")):
        tcPr.remove(old)
    tcPr.append(parse_xml(
        '<w:tcW xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        f'w:w="{cm_to_twips(width_cm)}" w:type="dxa"/>',
    ))


def set_cell_margins_dxa(cell: Any, *, top: int = 0, start: int = 0, bottom: int = 0, end: int = 0) -> None:
    from docx.oxml import parse_xml
    from docx.oxml.ns import qn

    tcPr = cell._tc.get_or_add_tcPr()
    old = tcPr.find(qn("w:tcMar"))
    if old is not None:
        tcPr.remove(old)
    tcPr.append(parse_xml(
        '<w:tcMar xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f'<w:top w:w="{top}" w:type="dxa"/>'
        f'<w:start w:w="{start}" w:type="dxa"/>'
        f'<w:bottom w:w="{bottom}" w:type="dxa"/>'
        f'<w:end w:w="{end}" w:type="dxa"/>'
        '</w:tcMar>',
    ))


def set_cell_margins_pt(
    cell: Any,
    *,
    top_pt: float = 0,
    left_pt: float = 0,
    bottom_pt: float = 0,
    right_pt: float = 0,
) -> None:
    from docx.oxml import parse_xml
    from docx.oxml.ns import qn

    tcPr = cell._tc.get_or_add_tcPr()
    for old in tcPr.findall(qn("w:tcMar")):
        tcPr.remove(old)
    tcPr.append(parse_xml(
        '<w:tcMar xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f'<w:top w:w="{pt_to_twips(top_pt)}" w:type="dxa"/>'
        f'<w:left w:w="{pt_to_twips(left_pt)}" w:type="dxa"/>'
        f'<w:bottom w:w="{pt_to_twips(bottom_pt)}" w:type="dxa"/>'
        f'<w:right w:w="{pt_to_twips(right_pt)}" w:type="dxa"/>'
        '</w:tcMar>',
    ))


def set_vertical_align(cell: Any, value: str = "top") -> None:
    from docx.oxml import parse_xml
    from docx.oxml.ns import qn

    tcPr = cell._tc.get_or_add_tcPr()
    for old in tcPr.findall(qn("w:vAlign")):
        tcPr.remove(old)
    tcPr.append(parse_xml(
        '<w:vAlign xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        f'w:val="{value}"/>',
    ))


def set_no_wrap(cell: Any) -> None:
    from docx.oxml import parse_xml
    from docx.oxml.ns import qn

    tcPr = cell._tc.get_or_add_tcPr()
    if tcPr.find(qn("w:noWrap")) is None:
        tcPr.append(parse_xml(
            '<w:noWrap xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
        ))


def set_table_no_cell_margins(table: Any) -> None:
    from docx.oxml import parse_xml
    from docx.oxml.ns import qn

    tblPr = table._tbl.tblPr
    for old in tblPr.findall(qn("w:tblCellMar")):
        tblPr.remove(old)
    tblPr.append(parse_xml(
        '<w:tblCellMar xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:top w:w="0" w:type="dxa"/>'
        '<w:left w:w="0" w:type="dxa"/>'
        '<w:bottom w:w="0" w:type="dxa"/>'
        '<w:right w:w="0" w:type="dxa"/>'
        '</w:tblCellMar>',
    ))


def reset_cell_paragraph(paragraph: Any, *, line_spacing: float = 1.0) -> None:
    from docx.shared import Pt

    pf = paragraph.paragraph_format
    pf.space_before = Pt(0)
    pf.space_after = Pt(0)
    pf.line_spacing = line_spacing


def format_run(
    run: Any,
    size_pt: float,
    *,
    bold: bool = False,
    color: tuple[int, int, int] | None = None,
    font_name: str,
) -> None:
    from docx.oxml.ns import qn
    from docx.shared import Pt, RGBColor

    run.bold = bold
    run.font.size = Pt(size_pt)
    run.font.name = font_name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), font_name)
    if color:
        run.font.color.rgb = RGBColor(*color)
