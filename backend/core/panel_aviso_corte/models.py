
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

from .errors import InvalidMatchRuleError, InvalidPanelError

MAX_IMAGES_PER_PANEL: int = 4

MAX_EXCEL_ROWS: int = 10_000

MAX_PANELS: int = 1000

MAX_LOGO_BYTES: int = 5 * 1024 * 1024

MAX_IMAGE_BYTES: int = 15 * 1024 * 1024


MatchStrategy = Literal["prefix", "contains", "exact", "regex"]
ExportMode = Literal["skip_empty", "include_empty"]

_VALID_MATCH_STRATEGIES: frozenset[str] = frozenset(
    {"prefix", "contains", "exact", "regex"},
)


_ISO_DATE_RE: re.Pattern[str] = re.compile(r"^\d{4}-\d{2}-\d{2}$")

_CAPTION_RE: re.Pattern[str] = re.compile(r"^IMAGEN N°(\d+): .+$")

_NAMED_CLAVE_GROUP_RE: re.Pattern[str] = re.compile(r"\(\?P<clave>")


@dataclass(frozen=True)
class PanelImageRef:

    filename: str
    caption: str
    position: int

    def __post_init__(self) -> None:
        if not isinstance(self.filename, str) or not self.filename:
            msg = "PanelImageRef.filename: debe ser una cadena no vacía"
            raise InvalidPanelError(
                msg,
            )
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

    filename: str
    columns: tuple[str, ...]
    normalized_columns: tuple[str, ...]
    rows: tuple[dict[str, str], ...]
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class MatchSummary:

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

    panels: tuple[Panel, ...]
    summary: MatchSummary
    warnings: tuple[str, ...] = ()


__all__ = [
    "MAX_EXCEL_ROWS",
    "MAX_IMAGES_PER_PANEL",
    "MAX_IMAGE_BYTES",
    "MAX_LOGO_BYTES",
    "MAX_PANELS",
    "ExcelSource",
    "ExportMode",
    "MatchResult",
    "MatchRule",
    "MatchStrategy",
    "MatchSummary",
    "Panel",
    "PanelImageRef",
]
