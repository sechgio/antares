
from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict
from io import BytesIO
from typing import Any

from backend.utils.html_sanitizer import sanitize_html_for_pdf

_FONT_CONFIG = threading.local()

_PDF_CACHE_MAX_ENTRIES = 2
_PDF_CACHE_MAX_BYTES = 8 * 1024 * 1024
_PDF_CACHE: OrderedDict[str, bytes] = OrderedDict()
_PDF_CACHE_LOCK = threading.Lock()


def reset_pdf_cache_for_tests() -> None:
    with _PDF_CACHE_LOCK:
        _PDF_CACHE.clear()


def _thread_font_config() -> Any:
    config = getattr(_FONT_CONFIG, "value", None)
    if config is None:
        from weasyprint import text

        config = text.fonts.FontConfiguration()
        _FONT_CONFIG.value = config
    return config


def deny_external_url_fetcher(url: str, **kwargs: Any) -> Any:
    from weasyprint import urls

    if str(url).strip().lower().startswith("data:"):
        return urls.URLFetcher().fetch(url, **kwargs)
    return urls.URLFetcherResponse(url, body=b"")


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
