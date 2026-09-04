from __future__ import annotations

import logging
import math
import re
from typing import Any

from backend.core.observability import log_event
from backend.handlers.common import with_locale

logger = logging.getLogger(__name__)

_ALLOWED_METRIC_NAMES = frozenset({"CLS", "INP", "LCP"})
_ALLOWED_RATINGS = frozenset({"good", "needs-improvement", "poor"})
_ALLOWED_NAVIGATION_TYPES = frozenset(
    {"navigate", "reload", "back-forward", "back-forward-cache", "prerender", "restore"}
)
_METRIC_ID_PATTERN = re.compile(r"v\d+-\d{13}-\d{13}")


def _safe_text(value: Any, max_length: int) -> str:
    if not isinstance(value, str):
        return ""
    return "".join(char for char in value.strip() if char.isprintable())[:max_length]


def _safe_metric_id(value: Any) -> str:
    text = _safe_text(value, 100)
    return text if _METRIC_ID_PATTERN.fullmatch(text) else ""


def _finite_non_negative(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    parsed = float(value)
    if not math.isfinite(parsed) or parsed < 0:
        return None
    return parsed


@with_locale
def telemetry(params: dict[str, Any]) -> dict[str, bool]:
    name = _safe_text(params.get("name"), 20).upper()
    value = _finite_non_negative(params.get("value"))
    if name not in _ALLOWED_METRIC_NAMES or value is None:
        return {"ok": False}

    rating = _safe_text(params.get("rating"), 30).lower()
    if rating not in _ALLOWED_RATINGS:
        rating = "unknown"
    metric_id = _safe_metric_id(params.get("id")) or "-"
    nav_type = _safe_text(params.get("navigationType") or params.get("navigation_type"), 30)
    if nav_type not in _ALLOWED_NAVIGATION_TYPES:
        nav_type = "unknown"

    msg = (
        f"rum metric={name} value={value:.4f} rating={rating} id={metric_id} nav={nav_type}"
    )
    # Evento estructurado con nombre: dimensiones en campos agregables
    # (allowlist validado en el sink por observability._rum_safe_field),
    # message solo como respaldo humano. Sin URL/PII por contrato.
    log_event(
        logger,
        logging.INFO,
        "rum.metric",
        message=msg,
        rum_name=name,
        rum_value=value,
        rum_rating=rating,
        rum_id=metric_id,
        rum_navigation_type=nav_type,
    )
    return {"ok": True}


HANDLERS = {
    "telemetry": telemetry,
}
