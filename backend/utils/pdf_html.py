"""Shared WeasyPrint HTML→PDF helpers with sanitizer + deny-by-default fetch."""

from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict
from io import BytesIO
from typing import Any

from backend.utils.html_sanitizer import sanitize_html_for_pdf

# Thread-local FontConfiguration (heavy jobs run concurrently).
_FONT_CONFIG = threading.local()

# Process-wide LRU of sanitized HTML → PDF (lock guards map only).
_PDF_CACHE_MAX_ENTRIES = 2
_PDF_CACHE_MAX_BYTES = 8 * 1024 * 1024
_PDF_CACHE: OrderedDict[str, bytes] = OrderedDict()
_PDF_CACHE_LOCK = threading.Lock()


def reset_pdf_cache_for_tests() -> None:
    """Clear the sanitized-PDF LRU (test helper)."""
    with _PDF_CACHE_LOCK:
        _PDF_CACHE.clear()


def _thread_font_config() -> Any:
    """Return a thread-local WeasyPrint FontConfiguration, creating it once."""
    config = getattr(_FONT_CONFIG, "value", None)
    if config is None:
        from weasyprint.text.fonts import FontConfiguration  # type: ignore[import-untyped]

        config = FontConfiguration()
        _FONT_CONFIG.value = config
    return config


def deny_external_url_fetcher(url: str, **kwargs: Any) -> Any:
    """Allow only data: URIs; deny all other fetches (defense in depth)."""
    from weasyprint.urls import URLFetcher, URLFetcherResponse  # type: ignore[import-untyped]

    if str(url).strip().lower().startswith("data:"):

        return URLFetcher().fetch(url, **kwargs)
    return URLFetcherResponse(url, body=b"")


def _cache_get(digest: str) -> bytes | None:
    with _PDF_CACHE_LOCK:
        pdf = _PDF_CACHE.get(digest)
        if pdf is None:
            return None
        _PDF_CACHE.move_to_end(digest)
        return pdf


def _cache_put(digest: str, pdf: bytes) -> None:
    if len(pdf) > _PDF_CACHE_MAX_BYTES:
        return
    with _PDF_CACHE_LOCK:
        _PDF_CACHE[digest] = pdf
        _PDF_CACHE.move_to_end(digest)
        while len(_PDF_CACHE) > _PDF_CACHE_MAX_ENTRIES:
            _PDF_CACHE.popitem(last=False)


def write_pdf_sanitized(html_string: str) -> bytes:
    """Sanitize HTML then render PDF with network/file URL fetch denied."""
    from weasyprint import HTML

    cleaned = sanitize_html_for_pdf(html_string)
    digest = hashlib.sha256(cleaned.encode("utf-8")).hexdigest()
    cached = _cache_get(digest)
    if cached is not None:
        return cached

    pdf_buffer = BytesIO()
    HTML(string=cleaned, url_fetcher=deny_external_url_fetcher).write_pdf(
        pdf_buffer,
        font_config=_thread_font_config(),
    )
    pdf = pdf_buffer.getvalue()
    _cache_put(digest, pdf)
    return pdf
