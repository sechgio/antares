"""Estrategias de emparejamiento de imágenes a filas y helpers de normalización."""

from __future__ import annotations

import os
import re
import unicodedata
from typing import TYPE_CHECKING

from .errors import InvalidMatchRuleError
from .models import (
    MAX_IMAGES_PER_PANEL,
    ExcelSource,
    ExportMode,
    MatchResult,
    MatchRule,
    Panel,
    PanelImageRef,
)

if TYPE_CHECKING:
    from collections.abc import Sequence

# Patrones precompilados usados por la pipeline de normalización de columnas

#: Conjunto de caracteres permitidos en el nombre de columna antes del
#: ``casefold`` final. Incluye dígitos, ASCII alfabético en ambos casings
#: (el casing se normaliza al final), espacio, guion bajo y guion.
_ALLOWED_CHARS_RE: re.Pattern[str] = re.compile(r"[^0-9A-Za-z _\-]")

#: Whitespace interno (para colapsar a un único espacio).
_WHITESPACE_RE: re.Pattern[str] = re.compile(r"\s+")

#: Date normalization patterns (module-level to avoid per-call recompilation).
_ISO_DATE_RE: re.Pattern[str] = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ISO_DATETIME_RE: re.Pattern[str] = re.compile(r"^(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}")
_DD_MM_YYYY_RE: re.Pattern[str] = re.compile(r"^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$")


# Helpers de normalización (tarea 5.1)


def _strip_diacritics(s: str) -> str:
    """Aplica NFKD y descarta cualquier *combining mark*.

    Helper privado compartido por :func:`_normalize` y
    :func:`_normalize_column_name`. Aislarlo evita duplicar la misma
    secuencia NFKD + filtro en dos funciones y garantiza que ambas
    pipelines partan exactamente de los mismos primitivos Unicode.
    """
    decomposed = unicodedata.normalize("NFKD", s)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def _normalize(s: str) -> str:
    """Normaliza una cadena para comparaciones insensibles a tildes y mayúsculas.

    Pipeline determinista:

    1. Coaccionar a ``str`` si el caller pasa algo distinto (defensivo;
       los callers suelen haber coaccionado antes).
    2. ``unicodedata.normalize('NFKD', s)`` — descompone ``á`` → ``a`` + ◌́,
       ``ﬁ`` → ``f`` + ``i``, etc.
    3. Descartar cualquier carácter *combining* (``unicodedata.combining``
       ≠ 0): elimina los diacríticos sueltos que deja el paso anterior.
    4. ``casefold`` final: equivalente a ``lower()`` pero más estricto para
       texto Unicode (``ß`` → ``ss``, etc.).

    **Preserva** espacios y símbolos. Úsese para comparar nombres de
    archivo o valores de celda donde los separadores son significativos.
    Para normalizar cabeceras de Excel use :func:`_normalize_column_name`.

    Función total: nunca lanza. Una entrada ``None`` se trata como ``""``.

    Ejemplos::

        >>> _normalize("Dirección")
        'direccion'
        >>> _normalize("  AV. Principal 123  ")
        '  av. principal 123  '
        >>> _normalize("Niño.JPG")
        'nino.jpg'

    :param s: cadena a normalizar.
    :returns: cadena normalizada, lista para comparación ``==`` /
        ``startswith`` / ``in``.
    """
    if not isinstance(s, str):
        s = str(s) if s is not None else ""
    return _strip_diacritics(s).casefold()


def _normalize_column_name(name: str) -> str:
    """Normaliza un nombre de columna de Excel preservando la semántica histórica.

    Pipeline (determinista), **idéntica byte-por-byte** a la que vivía
    inline en el importer:

    1. Coacción defensiva a ``str``.
    2. ``NFKD`` + descarte de *combining marks* (via :func:`_strip_diacritics`).
    3. ``strip`` + colapso de whitespace interno a un solo espacio.
    4. Eliminación de todos los caracteres fuera de ``[0-9 A-Za-z _-]``
       (paréntesis, dos puntos, comas, puntos, etc.).
    5. Segundo colapso de whitespace por si la limpieza dejó espacios
       dobles.
    6. ``casefold`` **al final**.

    El ``casefold`` se aplica tras la eliminación de símbolos para
    mantener la compatibilidad exacta con la implementación previa: esto
    significa, p. ej., que un carácter como ``ß`` (que no está en
    ``[A-Za-z]``) se elimina antes de que ``casefold`` pueda expandirlo
    a ``ss``. Cambiar este orden rompería el contrato con los tests
    existentes del importer.

    Función total: nunca lanza. Un nombre que se vuelve cadena vacía
    tras el pipeline lo detecta el caller y es tratado como cabecera
    inválida (Req 6.6).

    Ejemplos::

        >>> _normalize_column_name("Cuadrante Afectado")
        'cuadrante afectado'
        >>> _normalize_column_name("DIRECCIÓN")
        'direccion'
        >>> _normalize_column_name("  Fecha de Corte  ")
        'fecha de corte'
        >>> _normalize_column_name("Motivo (principal):")
        'motivo principal'

    :param name: nombre de columna original (tal como aparece en la
        cabecera del Excel).
    :returns: nombre normalizado, adecuado como clave estable de columna.
    """
    if not isinstance(name, str):
        name = str(name) if name is not None else ""

    without_diacritics = _strip_diacritics(name)
    collapsed = _WHITESPACE_RE.sub(" ", without_diacritics).strip()
    cleaned = _ALLOWED_CHARS_RE.sub("", collapsed)
    # Segundo colapso por si la limpieza dejó espacios dobles.
    cleaned = _WHITESPACE_RE.sub(" ", cleaned).strip()
    return cleaned.casefold()


def _normalize_date_str(raw: str) -> str:
    """Normaliza una cadena de fecha a ISO YYYY-MM-DD."""
    raw = raw.strip()
    if not raw:
        return ""
    if _ISO_DATE_RE.match(raw):
        return raw
    m = _ISO_DATETIME_RE.match(raw)
    if m:
        return m.group(1)
    m = _DD_MM_YYYY_RE.match(raw)
    if m:
        day, month, year = m.group(1), m.group(2), m.group(3)
        return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
    return raw


def match_prefix(normalized_value: str, normalized_stem: str) -> bool:
    return normalized_stem.startswith(normalized_value)


def match_contains(normalized_value: str, normalized_stem: str) -> bool:
    return normalized_value in normalized_stem


def match_exact(normalized_value: str, normalized_stem: str) -> bool:
    return normalized_stem == normalized_value


def match_regex(normalized_value: str, normalized_stem: str, compiled: re.Pattern[str]) -> bool:
    m = compiled.match(normalized_stem)
    if not m:
        return False
    captured = m.group("clave")
    if captured is None:
        return False
    return _normalize(captured) == normalized_value


def compile_match_rule(rule: MatchRule) -> re.Pattern[str] | None:
    """Pre-compila el patrón regex de una regla."""
    if rule.strategy != "regex":
        return None
    assert rule.regex_pattern is not None
    try:
        compiled = re.compile(rule.regex_pattern, re.IGNORECASE)
    except re.error as exc:
        msg = f"Expresión regular inválida: {exc}"
        raise InvalidMatchRuleError(
            msg,
        ) from exc
    if "(?P<clave>" not in rule.regex_pattern:
        msg = "La expresión regular debe contener el grupo nombrado (?P<clave>...)"
        raise InvalidMatchRuleError(
            msg,
        )
    return compiled


def match_image_to_row(rule: MatchRule, cell_value: str, filename: str, compiled: re.Pattern[str] | None = None) -> bool:
    normalized_value = _normalize(cell_value)
    stem, _ = os.path.splitext(filename)
    normalized_stem = _normalize(stem)

    if rule.strategy == "prefix":
        return match_prefix(normalized_value, normalized_stem)
    if rule.strategy == "contains":
        return match_contains(normalized_value, normalized_stem)
    if rule.strategy == "exact":
        return match_exact(normalized_value, normalized_stem)
    if rule.strategy == "regex":
        if compiled is None:
            compiled = compile_match_rule(rule)
        assert compiled is not None
        return match_regex(normalized_value, normalized_stem, compiled)
    return False


def build_panels(
    source: ExcelSource,
    rule: MatchRule,
    image_names: Sequence[str],
    address_column: str | None,
    export_mode: ExportMode,
) -> MatchResult:
    from .models import MatchResult, MatchSummary, Panel, PanelImageRef

    compiled = compile_match_rule(rule) if rule.strategy == "regex" else None

    panels: list[Panel] = []
    warnings: list[str] = []
    assigned_images: set[str] = set()
    matched_image_names: set[str] = set()
    rows_without_images_keys: list[str] = []
    rows_with_images = 0

    try:
        key_col_index = source.normalized_columns.index(_normalize_column_name(rule.key_column))
        key_col_original = source.columns[key_col_index]
    except ValueError:
        key_col_original = rule.key_column

    address_col_original: str | None = None
    if address_column:
        try:
            addr_idx = source.normalized_columns.index(_normalize_column_name(address_column))
            address_col_original = source.columns[addr_idx]
        except ValueError:
            address_col_original = address_column

    cuadrante_col: str | None = None
    fecha_corte_col: str | None = None
    motivo_col: str | None = None
    for col_orig, col_norm in zip(source.columns, source.normalized_columns, strict=False):
        if col_norm == "cuadrante afectado" and cuadrante_col is None:
            cuadrante_col = col_orig
        elif col_norm == "fecha de corte" and fecha_corte_col is None:
            fecha_corte_col = col_orig
        elif col_norm == "motivo" and motivo_col is None:
            motivo_col = col_orig

    def _resolve_panel_fields(row: dict[str, str]) -> tuple[str, str, str]:
        cuadrante = row.get(cuadrante_col, "") if cuadrante_col else ""
        if not cuadrante:
            cuadrante = row.get(key_col_original, "")
        fecha_corte_raw = row.get(fecha_corte_col, "") if fecha_corte_col else ""
        fecha_corte = _normalize_date_str(fecha_corte_raw)
        motivo = row.get(motivo_col, "") if motivo_col else ""
        return cuadrante, fecha_corte, motivo

    all_entries: list[tuple[str, str, int]] = []

    for row_idx, row in enumerate(source.rows):
        cell_value = row.get(key_col_original, "")
        matched_for_row: list[str] = []

        for img_name in image_names:
            if img_name in assigned_images:
                continue
            if match_image_to_row(rule, cell_value, img_name, compiled):
                matched_for_row.append(img_name)
                matched_image_names.add(img_name)

        if not matched_for_row:
            if export_mode == "include_empty":
                cuadrante, fecha_corte, motivo = _resolve_panel_fields(row)
                panel = Panel(
                    cuadrante=cuadrante,
                    fecha_corte=fecha_corte,
                    motivo=motivo,
                    imagenes=(),
                    source_row_index=row_idx,
                )
                panels.append(panel)
            rows_without_images_keys.append(cell_value)
            continue

        rows_with_images += 1
        matched_for_row.sort(key=str.lower)
        overflow = matched_for_row[MAX_IMAGES_PER_PANEL:]
        matched_for_row = matched_for_row[:MAX_IMAGES_PER_PANEL]

        if overflow:
            warnings.append(
                f"Fila '{cell_value}': {len(overflow)} imagen(es) descartadas "
                f"por exceder el límite de {MAX_IMAGES_PER_PANEL}",
            )

        direccion = "(Indicar dirección según lista de usuarios)"
        if address_col_original:
            direccion = row.get(address_col_original, "") or "(Indicar dirección según lista de usuarios)"

        for img_name in matched_for_row:
            assigned_images.add(img_name)
            all_entries.append((img_name, direccion, row_idx))

    global_img_number = 0
    for batch_start in range(0, len(all_entries), MAX_IMAGES_PER_PANEL):
        batch = all_entries[batch_start:batch_start + MAX_IMAGES_PER_PANEL]
        first_row_idx = batch[0][2]
        first_row = source.rows[first_row_idx]
        cuadrante, fecha_corte, motivo = _resolve_panel_fields(first_row)

        image_refs: list[PanelImageRef] = []
        for pos_in_panel, (img_name, direccion, _) in enumerate(batch, start=1):
            global_img_number += 1
            caption = f"IMAGEN N°{global_img_number}: {direccion}"
            image_refs.append(
                PanelImageRef(filename=img_name, caption=caption, position=pos_in_panel),
            )

        panel = Panel(
            cuadrante=cuadrante,
            fecha_corte=fecha_corte,
            motivo=motivo,
            imagenes=tuple(image_refs),
            source_row_index=batch[0][2],
        )
        panels.append(panel)

    unmatched = [img for img in image_names if img not in matched_image_names]
    summary = MatchSummary(
        total_rows=len(source.rows),
        rows_with_images=rows_with_images,
        rows_without_images=len(source.rows) - rows_with_images,
        total_images=len(image_names),
        matched_images=len(matched_image_names),
        unmatched_images=len(unmatched),
        unmatched_image_names=tuple(unmatched),
        rows_without_images_keys=tuple(rows_without_images_keys),
    )

    return MatchResult(
        panels=tuple(panels),
        summary=summary,
        warnings=tuple(warnings),
    )


__all__: list[str] = [
    "build_panels",
    "compile_match_rule",
    "match_contains",
    "match_exact",
    "match_image_to_row",
    "match_prefix",
    "match_regex",
]
