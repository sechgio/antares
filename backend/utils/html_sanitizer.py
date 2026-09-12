
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


# Numeric refs decode in browsers without the trailing semicolon; named refs
# keep it required (the no-semicolon legacy named set is not decoded inside
# attributes when followed by alnum/'=', so requiring ';' matches that).
_URL_ENTITY_RE = re.compile(r"&(?:#(x[0-9a-fA-F]+|\d+);?|([a-zA-Z][a-zA-Z0-9]*);)")
_NAMED_URL_ENTITIES = {
    "colon": ":", "tab": "\t", "newline": "\n", "sol": "/", "bsol": "\\",
    "period": ".", "amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'",
}


def is_safe_data_url(url: str) -> bool:
    lowered = str(url).strip().lower()
    return any(lowered.startswith(prefix) for prefix in SAFE_DATA_URI_PREFIXES)


def _decode_url_entities(value: str) -> str:
    def _sub(match: re.Match[str]) -> str:
        num, name = match.group(1), match.group(2)
        if num is not None:
            try:
                code = int(num[1:], 16) if num[0].lower() == "x" else int(num, 10)
            except ValueError:
                return match.group(0)
            return chr(code) if 0 <= code <= 0x10FFFF else match.group(0)
        mapped = _NAMED_URL_ENTITIES.get(name.lower())
        return mapped if mapped is not None else match.group(0)

    return _URL_ENTITY_RE.sub(_sub, str(value))


def _collapse_unsafe_url(match: re.Match[str]) -> str:
    url_value = _decode_url_entities(match.group(2))
    if is_safe_data_url(url_value):
        return match.group(0)
    return "url('')"


def _neutralize_url_attr(match: re.Match[str]) -> str:
    attr = match.group(1)
    quote = match.group(2) or ""
    url_value = _decode_url_entities(match.group(3))
    import urllib.parse

    cleaned = re.sub(r"\s+", "", url_value.strip()).lower()
    cleaned = re.sub(r"\s*:\s*", ":", cleaned)
    try:
        parsed = urllib.parse.urlparse(cleaned)
        scheme = parsed.scheme.lower()
    except Exception:
        scheme = ""
    if cleaned.startswith("data:"):
        if not is_safe_data_url(url_value):
            return f"{attr}={quote}{quote}"
        if cleaned.startswith("data:text/html"):
            return f"{attr}={quote}{quote}"
        return match.group(0)
    if scheme in ("javascript", "vbscript") or cleaned.startswith(("javascript:", "vbscript:")):
        return f"{attr}={quote}{quote}"
    if scheme in ("http", "https", "file"):
        return f"{attr}={quote}{quote}"
    if any(cleaned.startswith(p) for p in ("javascript:", "vbscript:", "http:", "https:", "file:")):
        return f"{attr}={quote}{quote}"
    return match.group(0)


def _neutralize_srcset_attr(match: re.Match[str]) -> str:
    attr = match.group(1)
    quote = match.group(2) or ""
    decoded = _decode_url_entities(match.group(3))
    for candidate in decoded.split(","):
        parts = candidate.split()
        url = parts[0] if parts else ""
        cleaned = re.sub(r"\s+", "", url).lower()
        if cleaned.startswith("data:"):
            if not is_safe_data_url(url) or cleaned.startswith("data:text/html"):
                return f"{attr}={quote}{quote}"
            continue
        scheme_match = re.match(r"^([a-z][a-z0-9+.-]*):", cleaned)
        scheme = scheme_match.group(1) if scheme_match else ""
        if scheme in ("javascript", "vbscript", "http", "https", "file"):
            return f"{attr}={quote}{quote}"
    return match.group(0)


def _dispatch_url_attr(match: re.Match[str]) -> str:
    if str(match.group(1)).lower() == "srcset":
        return _neutralize_srcset_attr(match)
    return _neutralize_url_attr(match)


def _neutralize_import_statement(match: re.Match[str]) -> str:
    url_value = _decode_url_entities(match.group(2))
    if is_safe_data_url(url_value):
        return match.group(0)
    return ""


def sanitize_html_for_pdf(html: str) -> str:
    stripped = str(html)
    stripped = re.sub(r"<!--[\s\S]*?-->", "", stripped)
    stripped = re.sub(r'<meta[^>]+http-equiv=["\']?Content-Security-Policy["\']?[^>]*>', "", stripped, flags=re.IGNORECASE)
    stripped = re.sub(r"<meta[^>]*http-equiv[^>]*>", "", stripped, flags=re.IGNORECASE)
    stripped = re.sub(r"<base[^>]*>", "", stripped, flags=re.IGNORECASE)
    stripped = re.sub(r"</base>", "", stripped, flags=re.IGNORECASE)
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
        r'(href|src|xlink:href|srcset|poster|action|formaction|background|cite|ping|longdesc)\s*=\s*(["\']?)\s*([^"\'>]+)\2',
        _dispatch_url_attr,
        stripped,
        flags=re.IGNORECASE,
    )
    stripped = re.sub(
        r'@import\s+(["\'])([^"\']*)\1\s*;?',
        _neutralize_import_statement,
        stripped,
        flags=re.IGNORECASE,
    )
    stripped = re.sub(r"expression\s*\(", "", stripped, flags=re.IGNORECASE)
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
