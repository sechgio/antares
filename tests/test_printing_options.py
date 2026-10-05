"""Opciones de impresión: parseo de páginas y tablas de calidad/dúplex."""

from __future__ import annotations

import pytest

from backend.core.printing import _DUPLEX_CODES, _QUALITY_DPI, _parse_pages


@pytest.mark.parametrize(
    ("spec", "total", "expected"),
    [
        (None, 5, None),
        ("", 2, None),
        ("1", 3, [0]),
        ("1-3", 5, [0, 1, 2]),
        ("2-2", 4, [1]),
        ("1-3,5", 6, [0, 1, 2, 4]),
        (" 1 - 2 , 4 ", 4, [0, 1, 3]),
        ([1, 3], 5, [0, 2]),
    ],
)
def test_parse_pages(spec, total, expected):
    assert _parse_pages(spec, total) == expected


@pytest.mark.parametrize("spec", ["abc", "1-", "0", "9", "3-2", [0], 3])
def test_parse_pages_rejects_invalid(spec):
    with pytest.raises(ValueError):
        _parse_pages(spec, 5)


def test_quality_and_duplex_tables():
    assert set(_QUALITY_DPI) == {"draft", "normal", "high"}
    assert _QUALITY_DPI["high"] > _QUALITY_DPI["normal"] > _QUALITY_DPI["draft"]
    assert _DUPLEX_CODES == {"none": 1, "long_edge": 2, "short_edge": 3}
