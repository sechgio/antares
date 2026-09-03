
from .errors import (
    InvalidExcelError,
    InvalidMatchRuleError,
    InvalidPanelError,
    PanelAvisoCorteError,
    RenderingError,
)
from .importer import parse_excel_bytes
from .matcher import build_panels, match_image_to_row
from .models import (
    MAX_EXCEL_ROWS,
    MAX_IMAGE_BYTES,
    MAX_IMAGES_PER_PANEL,
    MAX_LOGO_BYTES,
    MAX_PANELS,
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
    "MAX_PANELS",
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
    "deserialize_panel",
    "match_image_to_row",
    "parse_excel_bytes",
    "render_docx",
    "render_pdf",
    "serialize_panel",
]
