"""Configuración personalizable de patrones de renombrado."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from backend.utils.paths import user_data_path

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
        _CONFIG_PATH = user_data_path("rename_patterns.json")
    return _CONFIG_PATH


def _validate_pattern(pattern: str, available_vars: set[str]) -> bool:
    """Valida que el patrón use variables disponibles."""
    if not pattern:
        return True  # Patrón vacío = mantener nombre
    import re
    placeholders = set(re.findall(r"\{(\w+)\}", pattern))
    # {seq} y {ext} siempre están disponibles
    allowed = available_vars | {"seq", "ext"}
    return placeholders.issubset(allowed)


def load_patterns() -> list[dict[str, Any]]:
    """Carga los patrones guardados o retorna los defaults."""
    path = _config_file()
    if path.exists():
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            patterns = data.get("patterns", [])
            if patterns and isinstance(patterns, list):
                validated = []
                for p in patterns:
                    if isinstance(p, dict) and "id" in p and "label" in p and "pattern" in p:
                        validated.append({
                            "id": str(p["id"]),
                            "label": str(p["label"]),
                            "pattern": str(p["pattern"]),
                        })
                if validated:
                    return validated
        except (json.JSONDecodeError, OSError, TypeError) as exc:
            logger.warning("Error leyendo patrones, usando defaults: %s", exc)
    return [dict(p) for p in DEFAULT_PATTERNS]


def save_patterns(patterns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Guarda la configuración de patrones en disco."""
    path = _config_file()
    validated = []
    seen_ids = set()
    for p in patterns:
        if isinstance(p, dict) and "id" in p and "label" in p and "pattern" in p:
            pid = str(p["id"])
            # Evitar IDs duplicados
            if pid in seen_ids:
                continue
            seen_ids.add(pid)
            validated.append({
                "id": pid,
                "label": str(p["label"]),
                "pattern": str(p["pattern"]),
            })
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"patterns": validated}, f, indent=2, ensure_ascii=False)
    return validated


def reset_to_defaults() -> list[dict[str, Any]]:
    """Restaura los patrones por defecto."""
    save_patterns(DEFAULT_PATTERNS)
    return [dict(p) for p in DEFAULT_PATTERNS]
