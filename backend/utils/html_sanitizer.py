"""HTML sanitizer for PDF rendering (Python mirror of shared/html-sanitizer.js)."""

from __future__ import annotations

import re

CSP_META = (
    '<meta http-equiv="Content-Security-Policy" '
    'content="default-src \'none\'; style-src \'unsafe-inline\'; '
    'img-src data: file:; font-src data:;">'
)

SAFE_DATA_URI_PREFIXES = (
    "data:image/png",
    "data:image/jpeg",
    "data:image/jpg",
    "data:image/gif",
    "data:image/bmp",
    "data:image/webp",
    "data:image/x-icon",
)


def is_safe_data_url(url: str) -> bool:
    lowered = str(url).strip().lower()
    return any(lowered.startswith(prefix) for prefix in SAFE_DATA_URI_PREFIXES)


def _collapse_unsafe_url(match: re.Match[str]) -> str:
    url_value = match.group(2)
    if is_safe_data_url(url_value):
        return match.group(0)
    return "url('')"


def sanitize_html_for_pdf(html: str) -> str:
    """Strip active content and external resource URLs before WeasyPrint."""
    stripped = str(html)
    stripped = re.sub(r"<script[^>]*>[\s\S]*?</script>", "", stripped, flags=re.IGNORECASE)
    stripped = re.sub(r"<iframe[^>]*>[\s\S]*?</iframe>", "", stripped, flags=re.IGNORECASE)
    stripped = re.sub(r"<object[^>]*>[\s\S]*?</object>", "", stripped, flags=re.IGNORECASE)
    stripped = re.sub(r"<embed[^>]*>", "", stripped, flags=re.IGNORECASE)
    stripped = re.sub(r"<link[^>]*>", "", stripped, flags=re.IGNORECASE)
    stripped = re.sub(r"<script[^>]*>", "", stripped, flags=re.IGNORECASE)
    stripped = re.sub(r"</script>", "", stripped, flags=re.IGNORECASE)
    stripped = re.sub(r"<iframe[^>]*>", "", stripped, flags=re.IGNORECASE)
    stripped = re.sub(r"</iframe>", "", stripped, flags=re.IGNORECASE)
    stripped = re.sub(r'\son[a-z]+\s*=\s*"[^"]*"', "", stripped, flags=re.IGNORECASE)
    stripped = re.sub(r"\son[a-z]+\s*=\s*'[^']*'", "", stripped, flags=re.IGNORECASE)
    stripped = re.sub(r"\son[a-z]+\s*=\s*`[^`]*`", "", stripped, flags=re.IGNORECASE)
    stripped = re.sub(r"\son[a-z]+\s*=\s*[^\s>]+", "", stripped, flags=re.IGNORECASE)
    stripped = re.sub(r"\son[a-z]+\b(?=\s|>|/)", "", stripped, flags=re.IGNORECASE)
    stripped = re.sub(
        r'(href|src|xlink:href)\s*=\s*(["\']?)\s*(?:javascript|vbscript):[^"\'>\s]*\2',
        r"\1=\2\2",
        stripped,
        flags=re.IGNORECASE,
    )
    stripped = re.sub(
        r'(href|src|xlink:href)\s*=\s*(["\']?)\s*(?:https?|file):[^"\'>\s]*\2',
        r"\1=\2\2",
        stripped,
        flags=re.IGNORECASE,
    )
    stripped = re.sub(
        r"url\(\s*(['\"]?)\s*(?:javascript|vbscript):[^'\")\s]*\1\s*\)",
        "url('')",
        stripped,
        flags=re.IGNORECASE,
    )
    stripped = re.sub(
        r"url\(\s*(['\"]?)([^'\")]+?)\1\s*\)",
        _collapse_unsafe_url,
        stripped,
        flags=re.IGNORECASE,
    )
    injected = re.sub(r"<head([^>]*)>", rf"<head\1>{CSP_META}", stripped, count=1, flags=re.IGNORECASE)
    if re.search(r"<head", injected, flags=re.IGNORECASE):
        return injected
    return CSP_META + injected
