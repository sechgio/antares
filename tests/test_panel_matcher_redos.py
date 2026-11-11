from __future__ import annotations

import pytest

from backend.core.panel_aviso_corte.errors import InvalidMatchRuleError
from backend.core.panel_aviso_corte.matcher import (
    _MAX_MATCH_INPUT_LEN,
    compile_match_rule,
    match_image_to_row,
)
from backend.core.panel_aviso_corte.models import MatchRule


def test_compile_accepts_regex_con_grupo_clave() -> None:
    rule = MatchRule(key_column="clave", strategy="regex", regex_pattern=r"(?P<clave>\d{6})[- ]")
    compiled = compile_match_rule(rule)
    assert compiled is not None


def test_compile_rejects_nested_quantifiers_redos() -> None:
    for pattern in (r"^(?P<clave>.+)+$", r"(?P<clave>[\w-]*)*$", r"(?P<clave>(a|b)*)*x"):
        with pytest.raises(InvalidMatchRuleError, match="cuantificadores anidados"):
            compile_match_rule(MatchRule(key_column="k", strategy="regex", regex_pattern=pattern))


def test_compile_rejects_pattern_demasiado_largo() -> None:
    with pytest.raises(InvalidMatchRuleError, match="largo permitido"):
        compile_match_rule(MatchRule(key_column="k", strategy="regex", regex_pattern=f"(?P<clave>{'a' * 300})"))


def test_match_input_se_acota_antes_del_match() -> None:
    rule = MatchRule(key_column="k", strategy="contains")
    stem = "x" * (_MAX_MATCH_INPUT_LEN + 5000)
    # con contains no es ReDoS; verifica que el input largo se acota sin error
    assert match_image_to_row(rule, "x", stem + ".png") is True
    assert match_image_to_row(rule, "y", stem + ".png") is False
