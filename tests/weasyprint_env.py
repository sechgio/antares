
from __future__ import annotations


def weasyprint_native_available() -> bool:
    try:
        from weasyprint import HTML  # noqa: F401
    except (OSError, ImportError, Exception):
        return False
    return True
