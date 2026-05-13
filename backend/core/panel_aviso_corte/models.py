"""Modelos canónicos del dominio Panel Aviso de Corte.

Todos los modelos son ``@dataclass(frozen=True)``: se comportan como valores
inmutables y son seguros para pasar entre capas (core ↔ handlers ↔ tests).
Los constructores aplican las invariantes I1..I6 descritas en la sección
"Invariantes globales del modelo" del documento de diseño; cualquier
violación se traduce en :class:`InvalidPanelError` o
:class:`InvalidMatchRuleError` con un mensaje que nombra el campo inválido.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

from .errors import InvalidMatchRuleError, InvalidPanelError

# Constantes públicas del dominio

#: Máximo de imágenes permitidas por Panel (ver I1).
MAX_IMAGES_PER_PANEL: int = 4

#: Límite superior de filas aceptadas al importar un Excel.
MAX_EXCEL_ROWS: int = 10_000

#: Tamaño máximo (bytes) admitido para cada logo del encabezado (5 MB).
MAX_LOGO_BYTES: int = 5 * 1024 * 1024

#: Tamaño máximo (bytes) admitido para cada imagen del bulk set (15 MB).
MAX_IMAGE_BYTES: int = 15 * 1024 * 1024

# Alias de tipo literales (espejo de los contratos TypeScript del frontend)

MatchStrategy = Literal["prefix", "contains", "exact", "regex"]
ExportMode = Literal["skip_empty", "include_empty"]

# Conjunto canónico de estrategias aceptadas (se usa en validaciones).
_VALID_MATCH_STRATEGIES: frozenset[str] = frozenset(
    {"prefix", "contains", "exact", "regex"},
)

# Regex internos de validación

# I4: fecha ISO-8601 "YYYY-MM-DD" (o cadena vacía, permitida en form-mode).
_ISO_DATE_RE: re.Pattern[str] = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# I3: caption "IMAGEN N°{N}: {direccion}" — captura el número secuencial
# global (no necesariamente 1..4) para usarlo en leyendas.
_CAPTION_RE: re.Pattern[str] = re.compile(r"^IMAGEN N°(\d+): .+$")

# I6: presencia del grupo nombrado (?P<clave>...) dentro del patrón regex.
_NAMED_CLAVE_GROUP_RE: re.Pattern[str] = re.compile(r"\(\?P<clave>")


# Modelos del dominio


@dataclass(frozen=True)
class PanelImageRef:
    """Referencia a una imagen dentro de un Panel.

    Invariantes aplicadas en ``__post_init__``:

    * ``filename`` es una cadena no vacía.
    * ``position`` ∈ {1, 2, 3, 4} (I2 parcial) — posición dentro del grid 2x2.
    * ``caption`` cumple ``^IMAGEN N°\\d+: .+$`` (I3) — el número es
      secuencial global (no necesariamente 1..4).
    """

    filename: str
    caption: str
    position: int

    def __post_init__(self) -> None:
        if not isinstance(self.filename, str) or not self.filename:
            msg = "PanelImageRef.filename: debe ser una cadena no vacía"
            raise InvalidPanelError(
                msg,
            )
        # ``bool`` es subtipo de ``int`` en Python; excluirlo explícitamente.
        if not isinstance(self.position, int) or isinstance(self.position, bool):
            msg = (
                "PanelImageRef.position: debe ser int, no "
                f"{type(self.position).__name__}"
            )
            raise InvalidPanelError(
                msg,
            )
        if not 1 <= self.position <= MAX_IMAGES_PER_PANEL:
            msg = (
                "PanelImageRef.position: debe estar en "
                f"1..{MAX_IMAGES_PER_PANEL}, se recibió {self.position}"
            )
            raise InvalidPanelError(
                msg,
            )
        if not isinstance(self.caption, str):
            msg = "PanelImageRef.caption: debe ser una cadena"
            raise InvalidPanelError(
                msg,
            )
        match = _CAPTION_RE.match(self.caption)
        if match is None:
            msg = (
                "PanelImageRef.caption: debe cumplir el formato "
                "'IMAGEN N°{N}: {direccion}'"
            )
            raise InvalidPanelError(
                msg,
            )


@dataclass(frozen=True)
class Panel:
    """Panel canónico (una hoja A4 del PDF consolidado).

    Invariantes aplicadas en ``__post_init__``:

    * ``fecha_corte`` cumple ``^\\d{4}-\\d{2}-\\d{2}$`` o es cadena vacía
      (I4; vacía permitida en form-mode).
    * ``imagenes`` es una tupla con a lo sumo :data:`MAX_IMAGES_PER_PANEL`
      elementos (I1).
    * Las ``position`` de las imágenes son únicas dentro del Panel (I2).

    La invariante I5 (unicidad global de una imagen entre Paneles) se
    aplica en el matcher, no aquí.
    """

    cuadrante: str
    fecha_corte: str
    motivo: str
    imagenes: tuple[PanelImageRef, ...] = field(default_factory=tuple)
    source_row_index: int | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.cuadrante, str):
            msg = "Panel.cuadrante: debe ser una cadena"
            raise InvalidPanelError(msg)
        if not isinstance(self.fecha_corte, str):
            msg = "Panel.fecha_corte: debe ser una cadena"
            raise InvalidPanelError(msg)
        if self.fecha_corte != "" and _ISO_DATE_RE.match(self.fecha_corte) is None:
            msg = (
                "Panel.fecha_corte: debe cumplir ISO YYYY-MM-DD o ser '' "
                f"(form-mode); se recibió {self.fecha_corte!r}"
            )
            raise InvalidPanelError(
                msg,
            )
        if not isinstance(self.motivo, str):
            msg = "Panel.motivo: debe ser una cadena"
            raise InvalidPanelError(msg)
        if not isinstance(self.imagenes, tuple):
            msg = (
                "Panel.imagenes: debe ser tuple, no "
                f"{type(self.imagenes).__name__}"
            )
            raise InvalidPanelError(
                msg,
            )
        if len(self.imagenes) > MAX_IMAGES_PER_PANEL:
            msg = (
                "Panel.imagenes: máximo "
                f"{MAX_IMAGES_PER_PANEL} imágenes, se recibieron "
                f"{len(self.imagenes)}"
            )
            raise InvalidPanelError(
                msg,
            )
        positions: list[int] = []
        for idx, ref in enumerate(self.imagenes):
            if not isinstance(ref, PanelImageRef):
                msg = (
                    f"Panel.imagenes[{idx}]: debe ser PanelImageRef, se recibió "
                    f"{type(ref).__name__}"
                )
                raise InvalidPanelError(
                    msg,
                )
            positions.append(ref.position)
        if len(set(positions)) != len(positions):
            msg = (
                "Panel.imagenes: las posiciones deben ser únicas, se "
                f"recibieron {positions}"
            )
            raise InvalidPanelError(
                msg,
            )
        if self.source_row_index is not None:
            if not isinstance(self.source_row_index, int) or isinstance(
                self.source_row_index, bool,
            ):
                msg = (
                    "Panel.source_row_index: debe ser int o None, se recibió "
                    f"{type(self.source_row_index).__name__}"
                )
                raise InvalidPanelError(
                    msg,
                )
            if self.source_row_index < 0:
                msg = (
                    "Panel.source_row_index: debe ser >= 0, se recibió "
                    f"{self.source_row_index}"
                )
                raise InvalidPanelError(
                    msg,
                )


@dataclass(frozen=True)
class MatchRule:
    """Regla de emparejamiento imagen → fila del Excel.

    Invariantes aplicadas en ``__post_init__``:

    * ``key_column`` es una cadena no vacía.
    * ``strategy`` ∈ {prefix, contains, exact, regex}.
    * Si ``strategy == 'regex'`` (I6):
        - ``regex_pattern`` compila sin errores.
        - ``regex_pattern`` contiene el grupo nombrado ``(?P<clave>...)``.
    """

    key_column: str
    strategy: MatchStrategy
    regex_pattern: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.key_column, str) or not self.key_column:
            msg = "MatchRule.key_column: debe ser una cadena no vacía"
            raise InvalidMatchRuleError(
                msg,
            )
        if self.strategy not in _VALID_MATCH_STRATEGIES:
            msg = (
                "MatchRule.strategy: debe ser uno de "
                f"{sorted(_VALID_MATCH_STRATEGIES)}, se recibió "
                f"{self.strategy!r}"
            )
            raise InvalidMatchRuleError(
                msg,
            )
        if self.strategy == "regex":
            if not isinstance(self.regex_pattern, str) or not self.regex_pattern:
                msg = (
                    "MatchRule.regex_pattern: debe ser una cadena no vacía "
                    "cuando strategy=='regex'"
                )
                raise InvalidMatchRuleError(
                    msg,
                )
            try:
                re.compile(self.regex_pattern)
            except re.error as err:
                msg = (
                    "MatchRule.regex_pattern: expresión regular inválida: "
                    f"{err}"
                )
                raise InvalidMatchRuleError(
                    msg,
                ) from err
            if _NAMED_CLAVE_GROUP_RE.search(self.regex_pattern) is None:
                msg = (
                    "MatchRule.regex_pattern: debe contener el grupo "
                    "nombrado (?P<clave>...)"
                )
                raise InvalidMatchRuleError(
                    msg,
                )


@dataclass(frozen=True)
class ExcelSource:
    """Archivo Excel importado y normalizado.

    No aplica invariantes adicionales más allá de las de tipado del
    dataclass: el importer (:mod:`.importer`) es el responsable de validar
    extensión, número de filas y estructura antes de construir este modelo.
    """

    filename: str
    columns: tuple[str, ...]
    normalized_columns: tuple[str, ...]
    rows: tuple[dict[str, str], ...]
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class MatchSummary:
    """Resumen numérico del emparejamiento (para la UI y los reportes)."""

    total_rows: int
    rows_with_images: int
    rows_without_images: int
    total_images: int
    matched_images: int
    unmatched_images: int
    unmatched_image_names: tuple[str, ...]
    rows_without_images_keys: tuple[str, ...]


@dataclass(frozen=True)
class MatchResult:
    """Resultado completo del emparejamiento: paneles, resumen, advertencias."""

    panels: tuple[Panel, ...]
    summary: MatchSummary
    warnings: tuple[str, ...] = ()


__all__ = [
    "MAX_EXCEL_ROWS",
    "MAX_IMAGES_PER_PANEL",
    "MAX_IMAGE_BYTES",
    "MAX_LOGO_BYTES",
    "ExcelSource",
    "ExportMode",
    "MatchResult",
    "MatchRule",
    "MatchStrategy",
    "MatchSummary",
    "Panel",
    "PanelImageRef",
]
