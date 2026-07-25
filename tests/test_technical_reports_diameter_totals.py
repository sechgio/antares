from backend.core.technical_reports.diameter_totals import (
    sum_diameter_columns,
    sum_diameter_row,
)


def test_sum_diameter_columns_adds_values_vertically() -> None:
    rows = [
        {"8": 1, "10": 1},
        {"10": 1},
        {"12": 1, "10": 1},
    ]
    diameters = ["2", "3", "4", "6", "8", "10", "12"]

    totals = sum_diameter_columns(rows, diameters)

    assert totals["8"] == 1
    assert totals["10"] == 3
    assert totals["12"] == 1
    assert totals["2"] == 0


def test_sum_diameter_row_adds_values_horizontally() -> None:
    row = {"2": 1, "4": 3, "6": 0, "8": 2}
    assert sum_diameter_row(row, ["2", "4", "6", "8"]) == 6


def test_sum_diameter_row_returns_zero_for_none() -> None:
    assert sum_diameter_row(None, ["2", "4"]) == 0


def test_sum_diameter_row_returns_zero_for_empty() -> None:
    assert sum_diameter_row({}, ["2", "4"]) == 0


def test_grand_total_consistent_both_dimensions() -> None:
    diameters = ["2", "4", "6"]
    rows = [
        {"2": 1, "4": 0, "6": 2},
        {"2": 0, "4": 3, "6": 0},
        {"2": 1, "4": 1, "6": 1},
    ]

    col_totals = sum_diameter_columns(rows, diameters)
    grand_from_cols = sum(col_totals.values())
    grand_from_rows = sum(sum_diameter_row(r, diameters) for r in rows)

    assert grand_from_rows == grand_from_cols == 9

