"""Shared utilities for format strategies."""
from __future__ import annotations


def _escape_pdf_text(value: str) -> str:
    """Escape text for PDF Tj operator using WinAnsiEncoding-compatible characters."""
    safe = value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    for src, dst in [
        ("\xe1", "a"), ("\xe9", "e"), ("\xed", "i"), ("\xf3", "o"), ("\xfa", "u"),
        ("\xc1", "A"), ("\xc9", "E"), ("\xcd", "I"), ("\xd3", "O"), ("\xda", "U"),
        ("\xf1", "n"), ("\xd1", "N"), ("\xfc", "u"), ("\xdc", "U"),
    ]:
        safe = safe.replace(src, dst)
    return safe
