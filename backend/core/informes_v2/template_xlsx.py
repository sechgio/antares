from __future__ import annotations

import io

from openpyxl import Workbook

from backend.core.informes_v2.importer import TEMPLATE_HEADERS


def build_template_xlsx_bytes() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Informes v2"
    sheet.append(TEMPLATE_HEADERS)
    # One empty example row so users see the structure
    sheet.append([""] * len(TEMPLATE_HEADERS))
    # Freeze header
    sheet.freeze_panes = "A2"
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
