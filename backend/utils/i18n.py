"""Simple i18n module for backend translations."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_LOCALE_DIR = Path(__file__).parent.parent / "locales"
_current_locale = "es"
_translations: dict[str, dict[str, str]] = {}


def _load(locale: str) -> dict[str, str]:
    path = _LOCALE_DIR / f"{locale}.json"
    if path.exists():
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                return data
            logger.warning("Locale file %s is not a dict, falling back to empty", path)
        except (json.JSONDecodeError, OSError, UnicodeDecodeError) as exc:
            logger.warning("Error loading locale %s: %s", path, exc)
    return {}


def set_locale(locale: str) -> None:
    global _current_locale
    _current_locale = locale
    if locale not in _translations:
        _translations[locale] = _load(locale)


# Load default locale on import so t() works immediately
set_locale("es")


def t(key: str, **kwargs: Any) -> str:
    """Translate a key with optional format arguments."""
    text = _translations.get(_current_locale, {}).get(key, key)
    return text.format(**kwargs) if kwargs else text
