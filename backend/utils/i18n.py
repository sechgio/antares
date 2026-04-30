"""Simple i18n module for backend translations."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_LOCALE_DIR = Path(__file__).parent.parent / "locales"
_current_locale = "es"
_translations: dict[str, dict[str, str]] = {}


def _load(locale: str) -> dict[str, str]:
    path = _LOCALE_DIR / f"{locale}.json"
    if path.exists():
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return {}


def set_locale(locale: str) -> None:
    """Set the current locale for translations."""
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
