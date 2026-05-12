"""Panel Aviso de Corte domain services.

Este paquete contiene la lógica de dominio de la herramienta
"Panel Aviso de Corte": importación de Excel, emparejamiento de
imágenes, modelos canónicos, serialización y renderizado a PDF.

La API pública se expone progresivamente a medida que se
implementan los submódulos (`models`, `serialization`, `importer`,
`matcher`, `rendering`). Actualmente se exportan la jerarquía de
errores, los modelos canónicos del dominio, las funciones de
serialización round-trip (`serialize_panel` / `deserialize_panel`)
y el importador de Excel (`parse_excel_bytes`).
"""

from .errors import (
    InvalidExcelError,
    InvalidMatchRuleError,
    InvalidPanelError,
    PanelAvisoCorteError,
    RenderingError,
)
from .importer import parse_excel_bytes
from .matcher import build_panels, compile_match_rule, match_image_to_row
from .models import (
    MAX_EXCEL_ROWS,
    MAX_IMAGE_BYTES,
    MAX_IMAGES_PER_PANEL,
    MAX_LOGO_BYTES,
    ExcelSource,
    ExportMode,
    MatchResult,
    MatchRule,
    MatchStrategy,
    MatchSummary,
    Panel,
    PanelImageRef,
)
from .rendering import render_docx, render_pdf
from .serialization import deserialize_panel, serialize_panel

__all__ = [
    "MAX_EXCEL_ROWS",
    "MAX_IMAGES_PER_PANEL",
    "MAX_IMAGE_BYTES",
    "MAX_LOGO_BYTES",
    "ExcelSource",
    "ExportMode",
    "InvalidExcelError",
    "InvalidMatchRuleError",
    "InvalidPanelError",
    "MatchResult",
    "MatchRule",
    "MatchStrategy",
    "MatchSummary",
    "Panel",
    "PanelAvisoCorteError",
    "PanelImageRef",
    "RenderingError",
    "build_panels",
    "compile_match_rule",
    "deserialize_panel",
    "match_image_to_row",
    "parse_excel_bytes",
    "render_docx",
    "render_pdf",
    "serialize_panel",
]
