"""Shared WeasyPrint HTML→PDF helpers with sanitizer + deny-by-default fetch."""

from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict
from io import BytesIO
from typing import Any

from backend.utils.html_sanitizer import sanitize_html_for_pdf

# One FontConfiguration per worker thread. The heavy scheduler may run several
# WeasyPrint jobs concurrently; a process-wide mutable singleton would race.
_FONT_CONFIG = threading.local()

# Small process-wide LRU of sanitized-HTML digest → PDF bytes. Values are
# immutable; the lock only protects the map, never WeasyPrint rendering.
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
        from weasyprint.text.fonts import FontConfiguration

        config = FontConfiguration()
        _FONT_CONFIG.value = config
    return config


def deny_external_url_fetcher(url: str, **kwargs: Any) -> Any:
    """Allow only data: URIs; deny all other fetches (defense in depth)."""
    from weasyprint.urls import URLFetcherResponse, default_url_fetcher  # type: ignore[import-untyped]

    if str(url).strip().lower().startswith("data:"):
        return default_url_fetcher(url, **kwargs)
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
