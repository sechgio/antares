from __future__ import annotations

import io

from openpyxl import Workbook

from backend.core.informes_v2.importer import R2_TEMPLATE_HEADERS, TEMPLATE_HEADERS


def build_template_xlsx_bytes(plantilla: str = "clasica") -> bytes:
    headers = R2_TEMPLATE_HEADERS if plantilla == "reservorios2" else TEMPLATE_HEADERS
    workbook = Workbook()
    sheet = workbook.worksheets[0]
    sheet.title = "Informes v2"
    sheet.append(headers)
    sheet.append([""] * len(headers))
    sheet.freeze_panes = "A2"
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
