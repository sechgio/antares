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


def _neutralize_url_attr(match: re.Match[str]) -> str:
    attr = match.group(1)
    quote = match.group(2) or ""
    url_value = match.group(3)
    # Normalize: remove whitespace, control chars, and decode for scheme check
    import urllib.parse

    cleaned = re.sub(r"\s+", "", url_value.strip()).lower()
    # Handle whitespace around colon: "javascript :"
    cleaned = re.sub(r"\s*:\s*", ":", cleaned)
    try:
        parsed = urllib.parse.urlparse(cleaned)
        scheme = parsed.scheme.lower()
    except Exception:
        scheme = ""
    if cleaned.startswith("data:"):
        if not is_safe_data_url(url_value):
            return f"{attr}={quote}{quote}"
        # Block data:text/html etc even if safe prefix check passed for image
        if cleaned.startswith("data:text/html"):
            return f"{attr}={quote}{quote}"
        return match.group(0)
    if scheme in ("javascript", "vbscript") or cleaned.startswith(("javascript:", "vbscript:")):
        return f"{attr}={quote}{quote}"
    if scheme in ("http", "https", "file"):
        return f"{attr}={quote}{quote}"
    # Fallback for encoded schemes
    if any(cleaned.startswith(p) for p in ("javascript:", "vbscript:", "http:", "https:", "file:")):
        return f"{attr}={quote}{quote}"
    return match.group(0)


def sanitize_html_for_pdf(html: str) -> str:
    """Strip active content and external resource URLs before WeasyPrint."""
    stripped = str(html)
    stripped = re.sub(r"<!--[\s\S]*?-->", "", stripped)
    stripped = re.sub(r'<meta[^>]+http-equiv=["\']?Content-Security-Policy["\']?[^>]*>', "", stripped, flags=re.IGNORECASE)
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
        r'(href|src|xlink:href)\s*=\s*(["\']?)\s*([^"\'>]+)\2',
        _neutralize_url_attr,
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
    if re.search(r"(^|[\s>])<head\b([^>]*)>", stripped, flags=re.IGNORECASE):
        return re.sub(r"(^|[\s>])<head\b([^>]*)>", rf"\1<head\2>{CSP_META}", stripped, count=1, flags=re.IGNORECASE)
    return CSP_META + stripped
