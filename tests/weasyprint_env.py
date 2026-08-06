"""Shared helpers for optional native deps (WeasyPrint/GTK)."""

from __future__ import annotations


def weasyprint_native_available() -> bool:
    """True when WeasyPrint can load its native libraries (Pango/GObject)."""
    try:
        from weasyprint import HTML  # noqa: F401
    except (OSError, ImportError, Exception):
        return False
    return True
