"""Fixtures y generadores Hypothesis compartidos para la suite Panel Aviso de Corte.

Este módulo provee estrategias reutilizables que los tests de propiedades
(`test_matcher_properties.py`, `test_serialization.py`, ...) consumirán. Los
valores generados son estructuras "dict"/"tuple" que imitan los dataclasses
canónicos definidos en ``backend.core.panel_aviso_corte.models``; los tests
responsables de instanciar los dataclasses reales lo harán localmente al
momento de ejecutarse. De esta forma la colección (``pytest --collect-only``)
no depende de que el módulo `models` exista todavía.
"""

from __future__ import annotations

import re
import string
from typing import TYPE_CHECKING, Any

import pytest
from hypothesis import settings as hypothesis_module_settings
from hypothesis import strategies as st

if TYPE_CHECKING:
    from collections.abc import Sequence

# Constantes espejo del diseño (se replican para evitar importar `models`
# antes de que exista). Si el módulo de modelos cambia, actualizar aquí.

MAX_IMAGES_PER_PANEL: int = 4
MAX_EXCEL_ROWS_FOR_TESTS: int = 200  # subset razonable del MAX_EXCEL_ROWS real
MAX_BULK_IMAGES_FOR_TESTS: int = 50
VALID_EXTENSIONS: tuple[str, ...] = (".jpg", ".jpeg", ".png", ".webp")
MATCH_STRATEGIES: tuple[str, ...] = ("prefix", "contains", "exact", "regex")
EXPORT_MODES: tuple[str, ...] = ("skip_empty", "include_empty")

# Alfabeto controlado para nombres/valores: evita control chars y garantiza
# reproducibilidad. Incluye letras unicode latinas comunes para ejercitar el
# normalizador NFKD + casefold del core.
_TEXT_ALPHABET = st.characters(
    min_codepoint=0x20,
    max_codepoint=0x017F,  # latin-1 + latin-extended A
    blacklist_categories=("Cs", "Cc"),
    blacklist_characters=("/", "\\", ":", "*", "?", '"', "<", ">", "|", "\n", "\r", "\t"),
)

_FILENAME_STEM_ALPHABET = st.characters(
    min_codepoint=0x30,
    max_codepoint=0x017F,
    blacklist_categories=("Cs", "Cc", "Zs"),
    blacklist_characters=("/", "\\", ":", "*", "?", '"', "<", ">", "|", ".", " "),
)


# Fixtures


@pytest.fixture
def hypothesis_settings() -> hypothesis_module_settings:
    """Perfil reutilizable para tests PBT del módulo.

    Permite a los tests aplicarlo con ``@hypothesis_settings`` vía
    ``@given(...)`` + ``@settings(...)``: los tests que necesiten el objeto
    ``settings`` ya construido pueden recibirlo por esta fixture.
    """
    return hypothesis_module_settings(max_examples=100, deadline=None)


# Estrategias primitivas


def _non_empty_text(max_size: int = 32) -> st.SearchStrategy[str]:
    return st.text(alphabet=_TEXT_ALPHABET, min_size=1, max_size=max_size).map(
        lambda s: s.strip() or "x",
    )


@st.composite
def filenames(draw: st.DrawFn, *, unique_suffix: bool = False) -> str:
    """Genera un nombre de archivo de imagen válido.

    - Stem no vacío, sin separadores de path ni extensión embebida.
    - Extensión ∈ {.jpg, .jpeg, .png, .webp}.
    - Varía el casing de la extensión (ej. ``.JPG``/``.Jpeg``).
    """
    stem = draw(st.text(alphabet=_FILENAME_STEM_ALPHABET, min_size=1, max_size=24))
    ext = draw(st.sampled_from(VALID_EXTENSIONS))
    # casing mixto para la extensión
    ext_casing = draw(st.sampled_from([ext, ext.upper(), ext.capitalize()]))
    # casing mixto para el stem (sólo si contiene ascii letters)
    if any(c in string.ascii_letters for c in stem):
        stem = draw(
            st.sampled_from([stem, stem.upper(), stem.lower(), stem.capitalize()]),
        )
    name = f"{stem}{ext_casing}"
    if unique_suffix:
        suffix = draw(st.integers(min_value=0, max_value=999_999))
        name = f"{stem}_{suffix}{ext_casing}"
    return name


@st.composite
def bulk_image_sets(
    draw: st.DrawFn,
    *,
    min_size: int = 1,
    max_size: int = MAX_BULK_IMAGES_FOR_TESTS,
) -> list[str]:
    """Genera una lista de nombres de archivo únicos (case-insensitive).

    La unicidad se aplica sobre ``casefold`` porque el matcher real trata los
    nombres como case-insensitive. Devuelve una lista (no set) para preservar
    el orden generado y permitir comparaciones bajo permutaciones.
    """
    target_size = draw(st.integers(min_value=min_size, max_value=max_size))
    chosen: list[str] = []
    seen: set[str] = set()
    # Presupuesto de intentos proporcional al tamaño buscado
    attempts_budget = target_size * 8
    while len(chosen) < target_size and attempts_budget > 0:
        candidate = draw(filenames())
        key = candidate.casefold()
        if key not in seen:
            seen.add(key)
            chosen.append(candidate)
        attempts_budget -= 1
    # Garantizar al menos `min_size` con un fallback determinista
    idx = 0
    while len(chosen) < min_size:
        candidate = f"fallback_{idx}.jpg"
        key = candidate.casefold()
        if key not in seen:
            seen.add(key)
            chosen.append(candidate)
        idx += 1
    return chosen


# Estrategias de Excel


@st.composite
def column_names(draw: st.DrawFn, *, count: int = 3) -> list[str]:
    """Genera una lista de nombres de columna únicos para un Excel."""
    return draw(
        st.lists(
            _non_empty_text(max_size=24),
            min_size=count,
            max_size=count,
            unique_by=lambda s: s.casefold(),
        ),
    )


@st.composite
def excel_rows(
    draw: st.DrawFn,
    *,
    columns: Sequence[str] | None = None,
) -> dict[str, str]:
    """Genera una fila de Excel: ``dict[str, str]`` indexada por columna.

    Si ``columns`` es None, se fabrica un set por defecto con columnas típicas.
    """
    cols = list(columns) if columns is not None else [
        "CUADRANTE AFECTADO",
        "FECHA DE CORTE",
        "MOTIVO",
        "DIRECCION",
    ]
    return {col: draw(_non_empty_text(max_size=48)) for col in cols}


@st.composite
def excel_sources(
    draw: st.DrawFn,
    *,
    min_rows: int = 1,
    max_rows: int = MAX_EXCEL_ROWS_FOR_TESTS,
    columns: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Genera una estructura espejo de ``ExcelSource``.

    Devuelve un dict con las claves: ``filename``, ``columns``,
    ``normalized_columns``, ``rows`` (tuple-of-dict), ``warnings``.
    """
    cols = list(columns) if columns is not None else draw(column_names(count=draw(st.integers(min_value=2, max_value=5))))
    normalized = tuple(_normalize_column(c) for c in cols)
    row_count = draw(st.integers(min_value=min_rows, max_value=max_rows))
    rows = tuple(
        draw(excel_rows(columns=cols)) for _ in range(row_count)
    )
    filename = draw(
        st.text(alphabet=_FILENAME_STEM_ALPHABET, min_size=1, max_size=24),
    ) + ".xlsx"
    return {
        "filename": filename,
        "columns": tuple(cols),
        "normalized_columns": normalized,
        "rows": rows,
        "warnings": (),
    }


def _normalize_column(name: str) -> str:
    """Aproximación local de la normalización de columnas (NFKD + casefold).

    Se mantiene aquí como utilidad de tests para no depender del matcher real;
    el core tendrá su propia implementación canónica (ver tarea 5.1).
    """
    import unicodedata

    stripped = unicodedata.normalize("NFKD", name)
    stripped = "".join(ch for ch in stripped if not unicodedata.combining(ch))
    collapsed = re.sub(r"\s+", " ", stripped).strip()
    cleaned = re.sub(r"[^0-9a-zA-Z _-]", "", collapsed)
    return cleaned.casefold()


# Estrategia de reglas de emparejamiento


@st.composite
def match_rules(
    draw: st.DrawFn,
    *,
    key_column: str | None = None,
    strategy: str | None = None,
) -> dict[str, Any]:
    """Genera un dict espejo de ``MatchRule``.

    - ``strategy`` ∈ {prefix, contains, exact, regex}.
    - Si la estrategia es ``regex``, el patrón incluye el grupo nombrado
      ``(?P<clave>...)`` y es sintácticamente válido.
    """
    chosen_strategy = strategy or draw(st.sampled_from(MATCH_STRATEGIES))
    chosen_key = key_column or draw(_non_empty_text(max_size=24))

    regex_pattern: str | None = None
    if chosen_strategy == "regex":
        # Patrones simples con grupo nombrado `clave` que compilan sin error.
        skeleton = draw(
            st.sampled_from(
                [
                    r"^(?P<clave>[\w\-]+)",
                    r"(?P<clave>\d+)",
                    r"^img_(?P<clave>[A-Za-z0-9]+)",
                    r"(?P<clave>[A-Za-zÁÉÍÓÚÑáéíóúñ0-9_-]+)",
                ],
            ),
        )
        # Sanity check: el patrón debe compilar.
        re.compile(skeleton)
        regex_pattern = skeleton

    return {
        "key_column": chosen_key,
        "strategy": chosen_strategy,
        "regex_pattern": regex_pattern,
    }


# Estrategia de modos de exportación y paneles


def export_modes() -> st.SearchStrategy[str]:
    """Estrategia simple para ``ExportMode``."""
    return st.sampled_from(EXPORT_MODES)


@st.composite
def _iso_date(draw: st.DrawFn) -> str:
    year = draw(st.integers(min_value=2000, max_value=2099))
    month = draw(st.integers(min_value=1, max_value=12))
    # Usar día ≤ 28 para evitar inválidos por mes corto sin lógica extra.
    day = draw(st.integers(min_value=1, max_value=28))
    return f"{year:04d}-{month:02d}-{day:02d}"


@st.composite
def panel_image_refs(
    draw: st.DrawFn,
    *,
    position: int,
    direccion: str | None = None,
) -> dict[str, Any]:
    """Genera un dict espejo de ``PanelImageRef`` con la posición dada."""
    if not 1 <= position <= MAX_IMAGES_PER_PANEL:
        msg = "position debe estar en 1..4"
        raise ValueError(msg)
    filename = draw(filenames())
    addr = direccion if direccion is not None else draw(_non_empty_text(max_size=48))
    caption = f"IMAGEN N°{position}: {addr}"
    return {
        "filename": filename,
        "caption": caption,
        "position": position,
    }


@st.composite
def panels(draw: st.DrawFn) -> dict[str, Any]:
    """Genera un dict espejo de ``Panel`` con 0..4 imágenes únicas.

    - ``fecha_corte`` en formato ISO ``YYYY-MM-DD`` (o cadena vacía ocasional).
    - ``imagenes`` tupla de refs con ``position`` únicas dentro del panel.
    - ``source_row_index`` puede ser None (form-mode) o entero ≥ 0.
    """
    cuadrante = draw(_non_empty_text(max_size=40))
    fecha_corte = draw(
        st.one_of(
            _iso_date(),
            st.just(""),
        ),
    )
    motivo = draw(_non_empty_text(max_size=120))

    n_images = draw(st.integers(min_value=0, max_value=MAX_IMAGES_PER_PANEL))
    positions = draw(
        st.lists(
            st.integers(min_value=1, max_value=MAX_IMAGES_PER_PANEL),
            min_size=n_images,
            max_size=n_images,
            unique=True,
        ),
    )
    positions.sort()

    # Garantizar filenames únicos dentro del panel
    image_refs: list[dict[str, Any]] = []
    used_names: set[str] = set()
    for pos in positions:
        # retry local para obtener un nombre único dentro del panel
        for _ in range(8):
            ref = draw(panel_image_refs(position=pos))
            if ref["filename"].casefold() not in used_names:
                used_names.add(ref["filename"].casefold())
                image_refs.append(ref)
                break
        else:
            fallback_name = f"img_{pos}_{len(image_refs)}.jpg"
            used_names.add(fallback_name.casefold())
            image_refs.append(
                {
                    "filename": fallback_name,
                    "caption": f"IMAGEN N°{pos}: placeholder",
                    "position": pos,
                },
            )

    source_row_index = draw(
        st.one_of(st.none(), st.integers(min_value=0, max_value=9_999)),
    )

    return {
        "cuadrante": cuadrante,
        "fecha_corte": fecha_corte,
        "motivo": motivo,
        "imagenes": tuple(image_refs),
        "source_row_index": source_row_index,
    }


__all__ = [
    "EXPORT_MODES",
    "MATCH_STRATEGIES",
    "MAX_BULK_IMAGES_FOR_TESTS",
    "MAX_EXCEL_ROWS_FOR_TESTS",
    "MAX_IMAGES_PER_PANEL",
    "VALID_EXTENSIONS",
    "bulk_image_sets",
    "column_names",
    "excel_rows",
    "excel_sources",
    "export_modes",
    "filenames",
    "hypothesis_settings",
    "match_rules",
    "panel_image_refs",
    "panels",
]
