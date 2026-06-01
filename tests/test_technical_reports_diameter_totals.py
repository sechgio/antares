from backend.core.technical_reports.diameter_totals import sum_diameter_columns


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
