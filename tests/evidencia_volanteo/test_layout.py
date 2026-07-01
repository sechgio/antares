"""Tests de dimensiones de layout A4."""

from __future__ import annotations

from backend.core.evidencia_volanteo.layout import (
    CONTENT_HEIGHT_CM,
    GAP_HEIGHT_CM,
    GAP_UNDER_HEADER_CM,
    HEADER_TOTAL_HEIGHT_CM,
    PHOTO_COLS,
    PHOTO_HEIGHT_CM,
    PHOTO_ROWS,
    PHOTO_WIDTH_CM,
    TABLE_HEIGHT_CM,
    TABLE_WIDTH_CM,
)


def test_table_fits_printable_height() -> None:
    assert TABLE_HEIGHT_CM <= CONTENT_HEIGHT_CM
    total = HEADER_TOTAL_HEIGHT_CM + GAP_UNDER_HEADER_CM + GAP_HEIGHT_CM + PHOTO_ROWS * PHOTO_HEIGHT_CM
    assert abs(total - TABLE_HEIGHT_CM) < 0.02


def test_three_column_widths_sum_to_table() -> None:
    assert abs(PHOTO_COLS * PHOTO_WIDTH_CM - TABLE_WIDTH_CM) < 0.02
