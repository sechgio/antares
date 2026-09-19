from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

# Agrupación de miles en español: punto seguido de tres dígitos exactos. Con
# menos o más decimales ("1.25", "12.5000") el punto sigue siendo decimal.
_THOUSANDS_GROUPS = re.compile(r"^-?\d{1,3}(?:\.\d{3})+$")


def _numeric_text(value: Any) -> Any:
    """Reescribe una celda escrita a mano a la sintaxis que entiende float()."""
    if not isinstance(value, str):
        return value
    text = value.strip()
    if "." in text and "," in text:
        return text.replace(".", "").replace(",", ".")
    if "," in text:
        return text.replace(",", ".")
    if _THOUSANDS_GROUPS.match(text):
        return text.replace(".", "")
    return text


def safe_int(value: Any, default: int = 0) -> int:
    if value is None or value == "":
        return default
    if isinstance(value, (datetime, date)):
        return default
    try:
        return int(float(_numeric_text(value)))
    except (TypeError, ValueError):
        return default


def safe_str(value: Any, default: str = "") -> str:
    if value is None:
        return default
    if isinstance(value, (datetime, date)):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip()
    return text or default
