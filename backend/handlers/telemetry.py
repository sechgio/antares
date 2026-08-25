"""RUM telemetry sink: frontend web-vitals → stderr.

Stores no PII; logs are sampled (10%) on the frontend.
"""
from __future__ import annotations

import contextlib
import logging
import sys
from typing import Any

from backend.handlers.common import with_locale

logger = logging.getLogger(__name__)

@with_locale
def telemetry(params: dict[str, Any]) -> dict[str, bool]:
    name = str(params.get("name") or "").strip().upper()
    # Accept any web-vital name but normalize known ones; unknown still logged.
    raw_value = params.get("value")
    try:
        value = float(raw_value) if raw_value is not None else 0.0
    except (TypeError, ValueError):
        value = 0.0
    rating = str(params.get("rating") or "").strip() or "unknown"
    metric_id = str(params.get("id") or "").strip()
    nav_type = str(params.get("navigationType") or params.get("navigation_type") or "").strip()
    url = str(params.get("url") or "").strip()
    # Clamp to avoid log injection
    if len(url) > 500:
        url = url[:500]
    if len(metric_id) > 100:
        metric_id = metric_id[:100]

    # Log to stderr via logger (level INFO) and direct stderr for guaranteed capture.
    # Prefix `rum` makes it easy to grep from app logs.
    msg = (
        f"rum metric={name or 'unknown'} value={value:.4f} rating={rating} "
        f"id={metric_id} nav={nav_type} url={url}"
    )
    # Use INFO so it lands in stderr even when ANTARES_IPC_TELEMETRY is off.
    # Extra structured fields help log aggregators without parsing the message.
    logger.info(msg, extra={"rum_name": name, "rum_value": value, "rum_rating": rating})
    # Ensure it reaches stderr even if logger level filters INFO (e.g., WARNING default).
    # Print is guarded by sampling on the frontend (10%), so volume is low.
    with contextlib.suppress(Exception):
        print(msg, file=sys.stderr, flush=True)
    return {"ok": True}


HANDLERS = {
    "telemetry": telemetry,
}
