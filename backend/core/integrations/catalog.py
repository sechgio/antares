from __future__ import annotations

import json
from pathlib import Path

from backend.core.integrations.types import JsonObject


def load_catalog_providers(path: Path) -> dict[str, JsonObject]:
    try:
        data: JsonObject = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    providers = data.get("providers") if isinstance(data, dict) else None
    return dict(providers) if isinstance(providers, dict) else {}
