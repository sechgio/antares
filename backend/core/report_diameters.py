from backend.utils.coercion import safe_int


def normalize_diameter_counts(diameters: list[str], source: object = None) -> dict[str, int]:
    counts = source if isinstance(source, dict) else {}
    return {diameter: safe_int(counts.get(diameter), 0) for diameter in diameters}
