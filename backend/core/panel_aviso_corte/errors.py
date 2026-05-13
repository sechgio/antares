"""Jerarquía de errores del módulo Panel Aviso de Corte.

Todas las excepciones heredan de :class:`backend.core.exceptions.AntaresError`
para integrarse con la jerarquía global de errores de la aplicación.
Cada clase expone un código canónico en el atributo de clase
``ERROR_CODE`` que el adaptador IPC puede usar para traducir el error
a una respuesta estructurada hacia el renderer.
"""

from __future__ import annotations

from backend.core.exceptions import AntaresError


class PanelAvisoCorteError(AntaresError):
    """Error base para cualquier fallo del módulo Panel Aviso de Corte."""

    ERROR_CODE: str = "PANEL_AVISO_CORTE_ERROR"


class InvalidExcelError(PanelAvisoCorteError):
    """El archivo Excel cargado es inválido o no pudo parsearse.

    Usado por el importador cuando la extensión no es ``.xlsx``, el
    archivo está vacío, excede el límite de filas, está corrupto o
    protegido con contraseña.
    """

    ERROR_CODE: str = "PANEL_AVISO_CORTE_INVALID_EXCEL"


class InvalidMatchRuleError(PanelAvisoCorteError):
    """La regla de emparejamiento configurada es inválida.

    Usado cuando la estrategia no es reconocida, el patrón regex no
    compila o el patrón regex no contiene el grupo nombrado
    ``(?P<clave>...)`` requerido por la estrategia ``regex``.
    """

    ERROR_CODE: str = "PANEL_AVISO_CORTE_INVALID_MATCH_RULE"


class InvalidPanelError(PanelAvisoCorteError):
    """Un Panel no cumple las invariantes del dominio.

    Usado por los modelos canónicos y por la capa de serialización
    cuando faltan campos obligatorios, los tipos son inválidos, se
    excede el máximo de 4 imágenes por panel, las posiciones se
    repiten, la fecha no es ISO-8601 o la leyenda no tiene el formato
    ``IMAGEN N°{n}: {direccion}``.
    """

    ERROR_CODE: str = "PANEL_AVISO_CORTE_INVALID_PANEL"


class RenderingError(PanelAvisoCorteError):
    """Fallo durante el renderizado HTML→PDF del panel consolidado.

    Usado cuando la plantilla Jinja2 no puede renderizarse, WeasyPrint
    falla al convertir el HTML a PDF o no hay paneles exportables.
    """

    ERROR_CODE: str = "PANEL_AVISO_CORTE_RENDERING_ERROR"
