from __future__ import annotations

from typing import Any


def sum_diameter_columns(
    rows: list[dict[str, Any] | None],
    diameters: list[str],
) -> dict[str, int]:
    totals = {diameter: 0 for diameter in diameters}
    for row in rows:
        if not row:
            continue
        for diameter in diameters:
            value = row.get(diameter)
            if not value:
                continue
            try:
                totals[diameter] += int(value)
            except (TypeError, ValueError):
                continue
    return totals


def sum_diameter_row(
    row: dict[str, Any] | None,
    diameters: list[str],
) -> int:
    if not row:
        return 0
    total = 0
    for diameter in diameters:
        value = row.get(diameter)
        if not value:
            continue
        try:
            total += int(value)
        except (TypeError, ValueError):
            continue
    return total

