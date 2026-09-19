from __future__ import annotations

import pytest

from backend.core.panel_aviso_corte.errors import InvalidMatchRuleError
from backend.core.panel_aviso_corte.matcher import (
    _normalize,
    _normalize_column_name,
    _normalize_date_str,
    build_panels,
    compile_match_rule,
    match_image_to_row,
)
from backend.core.panel_aviso_corte.models import ExcelSource, MatchRule


def _rule(strategy: str = "exact", key_column: str = "clave", regex_pattern: str | None = None) -> MatchRule:
    return MatchRule(key_column=key_column, strategy=strategy, regex_pattern=regex_pattern)


def _source(columns: list[str], rows: list[dict[str, str]]) -> ExcelSource:
    return ExcelSource(
        filename="src.xlsx",
        columns=tuple(columns),
        normalized_columns=tuple(_normalize_column_name(c) for c in columns),
        rows=tuple(rows),
    )


def test_normalize_acepta_no_string() -> None:
    assert _normalize(123) == "123"
    assert _normalize(None) == ""
    assert _normalize_column_name(None) == ""
    assert _normalize_column_name("  Año  Fiscal! ") == "ano fiscal"


def test_normalize_date_str_formatos() -> None:
    assert _normalize_date_str("") == ""
    assert _normalize_date_str("2024-05-03") == "2024-05-03"
    assert _normalize_date_str("2024-05-03 14:30") == "2024-05-03"
    assert _normalize_date_str("3/5/2024") == "2024-05-03"
    assert _normalize_date_str("03-05-2024") == "2024-05-03"
    assert _normalize_date_str("texto") == "texto"


def test_compile_match_rule_solo_regex_y_validaciones() -> None:
    assert compile_match_rule(_rule(strategy="exact")) is None
    # MatchRule.__post_init__ valida al construir; compile_match_rule revalida por si se le pasa una regla no normalizada
    with pytest.raises(InvalidMatchRuleError):
        _rule(strategy="regex", regex_pattern="([")
    with pytest.raises(InvalidMatchRuleError):
        _rule(strategy="regex", regex_pattern="abc(\\d+)")
    compiled = compile_match_rule(_rule(strategy="regex", regex_pattern=r"foto-(?P<clave>\d+)"))
    assert compiled is not None

    # regla inconsistente (bypaseando __post_init__) → compile_match_rule defiende igual
    rule = _rule(strategy="regex", regex_pattern=r"foto-(?P<clave>\d+)")
    object.__setattr__(rule, "regex_pattern", "([")
    with pytest.raises(InvalidMatchRuleError, match="inválida"):
        compile_match_rule(rule)
    object.__setattr__(rule, "regex_pattern", "abc")
    with pytest.raises(InvalidMatchRuleError, match="clave"):
        compile_match_rule(rule)


def test_match_regex_captura_y_compila_si_no_recibe_compiled() -> None:
    rule = _rule(strategy="regex", regex_pattern=r"foto-(?P<clave>\d+)")
    assert match_image_to_row(rule, "123", "foto-123.jpg") is True
    assert match_image_to_row(rule, "999", "foto-123.jpg") is False


def test_match_regex_sin_grupo_capturado_devuelve_false() -> None:
    import re

    rule = _rule(strategy="regex", regex_pattern=r"foto-(?P<clave>\d+)")
    compiled = re.compile(r"^nada-(?P<clave>\d+)$", re.IGNORECASE)
    assert match_image_to_row(rule, "123", "foto-123.jpg", compiled) is False


def test_match_image_to_row_valor_vacio_nunca_matchea() -> None:
    assert match_image_to_row(_rule(strategy="exact"), "", "a.jpg") is False
    assert match_image_to_row(_rule(strategy="exact"), "  ", "a.jpg") is False


def test_build_panels_columna_no_encontrada_usa_nombre_directo() -> None:
    src = _source(["Clave"], [{"Clave": "A1"}])
    rule = _rule(key_column="columna inexistente")
    result = build_panels(src, rule, ["A1_foto.jpg"], None, "include_empty")
    # clave no encontrada → cell_value "" → sin match, pero fila contada
    assert result.summary.total_rows == 1


def test_build_panels_include_empty_crea_panel_sin_imagenes() -> None:
    src = _source(
        ["Clave", "Cuadrante Afectado", "Fecha de Corte", "Motivo"],
        [{"Clave": "ZZZ", "Cuadrante Afectado": "C-1", "Fecha de Corte": "3/5/2024", "Motivo": "deuda"}],
    )
    result = build_panels(src, _rule(), ["otra.jpg"], None, "include_empty")
    assert len(result.panels) == 1
    panel = result.panels[0]
    assert panel.imagenes == ()
    assert panel.cuadrante == "C-1"
    assert panel.fecha_corte == "2024-05-03"
    assert panel.motivo == "deuda"
    assert result.summary.unmatched_images == 1


def test_build_panels_include_empty_intercala_vacios_en_su_fila() -> None:
    src = _source(
        ["Clave", "Cuadrante Afectado"],
        [
            {"Clave": "A", "Cuadrante Afectado": "C-A"},
            {"Clave": "B", "Cuadrante Afectado": "C-B"},
            {"Clave": "C", "Cuadrante Afectado": "C-C"},
        ],
    )
    result = build_panels(
        src,
        _rule(strategy="prefix"),
        ["A1.jpg", "A2.jpg", "A3.jpg", "A4.jpg", "C1.jpg"],
        None,
        "include_empty",
    )
    # El agrupamiento de 4 comparte hoja entre A y C, pero la hoja vacía de B
    # conserva su lugar entre ambas en el PDF y en el preview.
    assert [p.source_row_index for p in result.panels] == [0, 1, 2]
    assert [len(p.imagenes) for p in result.panels] == [4, 0, 1]
    assert [p.cuadrante for p in result.panels] == ["C-A", "C-B", "C-C"]


def test_build_panels_address_column_fallback_cuando_no_existe() -> None:
    src = _source(["Clave"], [{"Clave": "A1"}])
    result = build_panels(src, _rule(strategy="prefix"), ["A1_foto.jpg"], "direccion faltante", "include_empty")
    assert len(result.panels) == 1
    assert "IMAGEN N°1" in result.panels[0].imagenes[0].caption
