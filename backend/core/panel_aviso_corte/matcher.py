"""Estrategias de emparejamiento de imágenes a filas y helpers de normalización.

Este módulo alberga la lógica de *matching* de la feature Panel Aviso de
Corte (tareas 6.x del plan) y los helpers de normalización Unicode
compartidos entre el importer y el propio matcher (tarea 5.1).

Responsabilidades actuales (tareas 5.1 y 6.2):

* :func:`_normalize` — helper de uso general que aplica ``NFKD``, descarta
  los caracteres *combining* (tildes, diéresis, etc.) y aplica
  ``casefold``. **Preserva** espacios y símbolos, por lo que es adecuado
  para comparar nombres de archivo o valores de celda (Req 7.5).
* :func:`_normalize_column_name` — variante específica para cabeceras de
  Excel. Reutiliza los mismos primitivos Unicode (``NFKD`` + descarte de
  *combining*) pero mantiene el **orden histórico** del importer:
  primero se eliminan símbolos con ``[^0-9A-Za-z _-]`` y sólo al final
  se aplica ``casefold``. Esto preserva byte-por-byte el resultado que
  venía produciendo el importer antes de esta refactorización y es
  importante para caracteres cuyo ``casefold`` produce secuencias
  alfabéticas (p. ej. ``ß`` → ``ss``) que en el orden original se
  pierden por no estar en ``[a-zA-Z]``.

Ambos helpers son módulo-privados (``_``-prefixed) y **no** se re-exportan
en ``__init__.py``: forman el contrato interno entre el importer y el
matcher, no la API pública de la feature.

Estrategias de match (tarea 6.2):

* :func:`match_prefix`, :func:`match_contains`, :func:`match_exact` y
  :func:`match_regex` — funciones puras de bajo nivel que operan sobre
  valores **ya normalizados**. No hacen I/O, no lanzan y no tocan
  ``MatchRule``; son el primitivo que compone el helper público.
* :func:`compile_match_rule` — pre-compila el ``re.Pattern`` de una
  :class:`~.models.MatchRule` con ``strategy == 'regex'`` para amortizar
  el coste en callers que iteran sobre muchas imágenes. Devuelve
  ``None`` para el resto de estrategias.
* :func:`match_image_to_row` — dispatcher de alto nivel que toma la regla,
  el valor de la celda y el nombre de fichero crudo, normaliza ambos
  extremos con :func:`_normalize`, deriva el *stem* con
  :func:`os.path.splitext` y delega en la estrategia correspondiente.

La composición final (``build_panels``) se añadirá en la tarea 6.3; este
módulo la albergará cuando se implemente.

.. note::
   Este módulo **no** debe importar de :mod:`.importer` para evitar ciclos;
   es el importer quien importa desde aquí.
"""

from __future__ import annotations

import os
import re
import unicodedata
from collections.abc import Sequence

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

# ---------------------------------------------------------------------------
# Patrones precompilados usados por la pipeline de normalización de columnas
# ---------------------------------------------------------------------------

#: Conjunto de caracteres permitidos en el nombre de columna antes del
#: ``casefold`` final. Incluye dígitos, ASCII alfabético en ambos casings
#: (el casing se normaliza al final), espacio, guion bajo y guion.
_ALLOWED_CHARS_RE: re.Pattern[str] = re.compile(r"[^0-9A-Za-z _\-]")

#: Whitespace interno (para colapsar a un único espacio).
_WHITESPACE_RE: re.Pattern[str] = re.compile(r"\s+")


# ---------------------------------------------------------------------------
# Helpers de normalización (tarea 5.1)
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Estrategias de match puras (sobre cadenas ya normalizadas)
# ---------------------------------------------------------------------------


def match_prefix(normalized_value: str, normalized_stem: str) -> bool:
    """Retorna ``True`` si *stem* comienza con *value* (insensible a
    mayúsculas/tildes)."""
    return normalized_stem.startswith(normalized_value)


def match_contains(normalized_value: str, normalized_stem: str) -> bool:
    """Retorna ``True`` si *value* aparece dentro de *stem*."""
    return normalized_value in normalized_stem


def match_exact(normalized_value: str, normalized_stem: str) -> bool:
    """Retorna ``True`` si *stem* == *value*."""
    return normalized_stem == normalized_value


def match_regex(normalized_value: str, normalized_stem: str, compiled: re.Pattern[str]) -> bool:
    """Retorna ``True`` si el grupo ``(?P<clave>...)`` del *compiled*
    captura una cadena que, normalizada, coincide con *normalized_value*."""
    m = compiled.match(normalized_stem)
    if not m:
        return False
    captured = m.group("clave")
    if captured is None:
        return False
    return _normalize(captured) == normalized_value


# ---------------------------------------------------------------------------
# Compilación y dispatch de alto nivel
# ---------------------------------------------------------------------------


def compile_match_rule(rule: MatchRule) -> re.Pattern[str] | None:
    """Pre-compila el patrón regex de una regla.

    :returns: ``re.Pattern`` si *strategy* es ``'regex'``, ``None`` en
        cualquier otro caso.
    :raises InvalidMatchRuleError: si la regex no compila o no contiene
        el grupo nombrado ``(?P<clave>...)``.
    """
    if rule.strategy != "regex":
        return None
    assert rule.regex_pattern is not None
    try:
        compiled = re.compile(rule.regex_pattern, re.IGNORECASE)
    except re.error as exc:
        raise InvalidMatchRuleError(
            f"Expresión regular inválida: {exc}"
        ) from exc
    if "(?P<clave>" not in rule.regex_pattern:
        raise InvalidMatchRuleError(
            "La expresión regular debe contener el grupo nombrado (?P<clave>...)"
        )
    return compiled


def match_image_to_row(rule: MatchRule, cell_value: str, filename: str, compiled: re.Pattern[str] | None = None) -> bool:
    """Determina si *filename* empareja con *cell_value* según *rule*.

    :param cell_value: valor crudo de la celda en la columna clave.
    :param filename: nombre de archivo de la imagen (puede incluir extensión).
    :param compiled: patrón pre-compilado (sólo para ``regex``); si es
        ``None`` se compila internamente.
    """
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


# ---------------------------------------------------------------------------
# Composición: build_panels
# ---------------------------------------------------------------------------


def build_panels(
    source: ExcelSource,
    rule: MatchRule,
    image_names: Sequence[str],
    address_column: str | None,
    export_mode: ExportMode,
) -> MatchResult:
    """Empareja imágenes con filas de *source* según *rule* y construye
    :class:`~.models.Panel`.

    Invariantes aplicadas:

    * I5: unicidad global de imagen (ninguna imagen aparece en >1 Panel).
    * I1/I2/I3: delegadas al constructor de :class:`Panel` / :class:`PanelImageRef`.
    * Capacidad máxima 4 imágenes por Panel; orden alfabético; overflow con
      warning.
    """
    from .models import MatchResult, MatchSummary, Panel, PanelImageRef

    compiled = compile_match_rule(rule) if rule.strategy == "regex" else None

    panels: list[Panel] = []
    warnings: list[str] = []
    assigned_images: set[str] = set()
    matched_image_names: set[str] = set()
    rows_without_images_keys: list[str] = []
    rows_with_images = 0

    # Resolver nombre original de la columna clave a partir del normalizado.
    # El importer garantiza que normalized_columns y columns tienen la misma
    # longitud y orden.
    try:
        key_col_index = source.normalized_columns.index(_normalize_column_name(rule.key_column))
        key_col_original = source.columns[key_col_index]
    except ValueError:
        # Fallback: si la columna clave no se encuentra por nombre normalizado,
        # intentar búsqueda exacta (por si el caller ya pasó el nombre original).
        key_col_original = rule.key_column

    # Resolver columna de dirección (nombre original)
    address_col_original: str | None = None
    if address_column:
        try:
            addr_idx = source.normalized_columns.index(_normalize_column_name(address_column))
            address_col_original = source.columns[addr_idx]
        except ValueError:
            address_col_original = address_column

    # Pre-resolver columnas de campos del Panel por nombre normalizado.
    # Esto evita depender de key_column o address_column para campos que
    # tienen su propia columna en el Excel (cuadrante, fecha, motivo).
    cuadrante_col: str | None = None
    fecha_corte_col: str | None = None
    motivo_col: str | None = None
    for col_orig, col_norm in zip(source.columns, source.normalized_columns):
        if col_norm == "cuadrante afectado" and cuadrante_col is None:
            cuadrante_col = col_orig
        elif col_norm == "fecha de corte" and fecha_corte_col is None:
            fecha_corte_col = col_orig
        elif col_norm == "motivo" and motivo_col is None:
            motivo_col = col_orig

    def _resolve_panel_fields(row: dict[str, str]) -> tuple[str, str, str]:
        """Extrae cuadrante, fecha_corte y motivo de la fila usando las
        columnas pre-resueltas, con fallback a la columna clave."""
        cuadrante = row.get(cuadrante_col, "") if cuadrante_col else ""
        # Fallback: si no hay columna 'CUADRANTE AFECTADO' explícita,
        # usar la columna clave (comportamiento legacy).
        if not cuadrante:
            cuadrante = row.get(key_col_original, "")
        fecha_corte = row.get(fecha_corte_col, "") if fecha_corte_col else ""
        motivo = row.get(motivo_col, "") if motivo_col else ""
        return cuadrante, fecha_corte, motivo

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
        # Orden alfabético y corte a 4
        matched_for_row.sort(key=str.lower)
        overflow = matched_for_row[MAX_IMAGES_PER_PANEL:]
        matched_for_row = matched_for_row[:MAX_IMAGES_PER_PANEL]

        if overflow:
            warnings.append(
                f"Fila '{cell_value}': {len(overflow)} imagen(es) descartadas "
                f"por exceder el límite de {MAX_IMAGES_PER_PANEL}"
            )

        image_refs: list[PanelImageRef] = []
        for pos, img_name in enumerate(matched_for_row, start=1):
            assigned_images.add(img_name)
            direccion = "(Indicar dirección según lista de usuarios)"
            if address_col_original:
                direccion = row.get(address_col_original, "") or "(Indicar dirección según lista de usuarios)"
            caption = f"IMAGEN N°{pos}: {direccion}"
            image_refs.append(PanelImageRef(filename=img_name, caption=caption, position=pos))

        cuadrante, fecha_corte, motivo = _resolve_panel_fields(row)

        panel = Panel(
            cuadrante=cuadrante,
            fecha_corte=fecha_corte,
            motivo=motivo,
            imagenes=tuple(image_refs),
            source_row_index=row_idx,
        )
        panels.append(panel)

    # Imágenes no emparejadas
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
