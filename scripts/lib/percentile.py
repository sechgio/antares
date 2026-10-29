"""Nearest-rank percentile shared by benchmark and scalability scripts."""

from __future__ import annotations

import math


def nearest_rank_percentile(values: list[float], q: float) -> float:
    """Return the nearest-rank percentile ``q`` (0 < q <= 1) of ``values``."""
    if not values:
        raise ValueError("values must be non-empty")
    ordered = sorted(values)
    rank = max(1, math.ceil(q * len(ordered)))
    return ordered[rank - 1]
