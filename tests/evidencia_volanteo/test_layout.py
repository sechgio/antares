
from __future__ import annotations

from backend.core.evidencia_volanteo.layout import (
    CONTENT_HEIGHT_CM,
    GAP_UNDER_HEADER_CM,
    HEADER_TOTAL_HEIGHT_CM,
    PHOTO_COLS,
    PHOTO_GAP_CM,
    PHOTO_GAP_COLS,
    PHOTO_GAP_ROWS,
    PHOTO_HEIGHT_CM,
    PHOTO_ROWS,
    PHOTO_TABLE_COLS,
    PHOTO_TABLE_ROWS,
    PHOTO_WIDTH_CM,
    TABLE_HEIGHT_CM,
    TABLE_WIDTH_CM,
)


def test_table_fits_printable_height() -> None:
    assert TABLE_HEIGHT_CM <= CONTENT_HEIGHT_CM
    total = (
        HEADER_TOTAL_HEIGHT_CM
        + GAP_UNDER_HEADER_CM
        + PHOTO_GAP_ROWS * PHOTO_GAP_CM
        + PHOTO_ROWS * PHOTO_HEIGHT_CM
    )
    assert abs(total - TABLE_HEIGHT_CM) < 0.02


def test_photo_and_gap_widths_sum_to_table() -> None:
    total = PHOTO_COLS * PHOTO_WIDTH_CM + PHOTO_GAP_COLS * PHOTO_GAP_CM
    assert abs(total - TABLE_WIDTH_CM) < 0.02


def test_uniform_gutter_panel_layout() -> None:
    assert PHOTO_GAP_COLS == PHOTO_COLS + 1
    assert PHOTO_GAP_ROWS == PHOTO_ROWS + 1
    assert PHOTO_TABLE_COLS == PHOTO_COLS + PHOTO_GAP_COLS
    assert PHOTO_TABLE_ROWS == PHOTO_ROWS + PHOTO_GAP_ROWS
