
from __future__ import annotations

from backend.core.exceptions import AntaresError


class PanelAvisoCorteError(AntaresError):

    ERROR_CODE: str = "PANEL_AVISO_CORTE_ERROR"


class InvalidExcelError(PanelAvisoCorteError):

    ERROR_CODE: str = "PANEL_AVISO_CORTE_INVALID_EXCEL"


class InvalidMatchRuleError(PanelAvisoCorteError):

    ERROR_CODE: str = "PANEL_AVISO_CORTE_INVALID_MATCH_RULE"


class InvalidPanelError(PanelAvisoCorteError):

    ERROR_CODE: str = "PANEL_AVISO_CORTE_INVALID_PANEL"


class RenderingError(PanelAvisoCorteError):

    ERROR_CODE: str = "PANEL_AVISO_CORTE_RENDERING_ERROR"
