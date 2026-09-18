
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

from backend.core.config_fields import get_field_names
from backend.core.config_store import JsonConfigStore
from backend.utils.paths import cached_config_path

logger = logging.getLogger(__name__)

DEFAULT_PATTERNS: list[dict[str, Any]] = [
    {"id": "code_name", "label": "BD + número", "pattern": "{codigo}_{nombre}_{seq}{ext}"},
    {"id": "code_seq", "label": "Código + número", "pattern": "{codigo}_{seq}{ext}"},
    {"id": "sequential", "label": "IMG + número", "pattern": "img_{seq}{ext}"},
    {"id": "keep", "label": "Mantener nombres", "pattern": ""},
]

_CONFIG_PATH: Path | None = None


def _config_file() -> Path:
    global _CONFIG_PATH
    if _CONFIG_PATH is None:
        _CONFIG_PATH = cached_config_path("patterns", "rename_patterns.json")
    return _CONFIG_PATH


def _validate_pattern(pattern: str, available_vars: set[str]) -> bool:
    if not pattern:
        return True
    placeholders = set(re.findall(r"\{(\w+)\}", pattern))
    allowed = available_vars | {"seq", "ext", "sep"}
    return placeholders.issubset(allowed)


def _parse_patterns_payload(data: Any) -> list[dict[str, Any]] | None:
    patterns = data.get("patterns", [])
    if not (patterns and isinstance(patterns, list)):
        return None
    validated = []
    for p in patterns:
        if isinstance(p, dict) and "id" in p and "label" in p and "pattern" in p:
            validated.append({
                "id": str(p["id"]),
                "label": str(p["label"]),
                "pattern": str(p["pattern"]),
            })
    return validated if validated else None


_store: JsonConfigStore[list[dict[str, Any]]] = JsonConfigStore(
    lambda: _config_file(),
    default=lambda: [dict(p) for p in DEFAULT_PATTERNS],
    parse=_parse_patterns_payload,
    serialize=lambda patterns: {"patterns": patterns},
    label="patrones",
)


def load_patterns() -> list[dict[str, Any]]:
    return _store.load()


def save_patterns(patterns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    available_vars = set(get_field_names())
    validated = []
    seen_ids = set()
    for p in patterns:
        if isinstance(p, dict) and "id" in p and "label" in p and "pattern" in p:
            pid = str(p["id"])
            if pid in seen_ids:
                continue
            seen_ids.add(pid)
            pattern = str(p["pattern"])
            if not _validate_pattern(pattern, available_vars):
                logger.warning("Patrón con variables inválidas, se guarda como está: %s", pattern)
            validated.append({
                "id": pid,
                "label": str(p["label"]),
                "pattern": pattern,
            })
    _store.save(validated)
    return validated


def reset_to_defaults() -> list[dict[str, Any]]:
    save_patterns(DEFAULT_PATTERNS)
    return [dict(p) for p in DEFAULT_PATTERNS]
