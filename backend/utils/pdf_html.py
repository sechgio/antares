"""Shared WeasyPrint HTML→PDF helpers with sanitizer + deny-by-default fetch."""

from __future__ import annotations

from io import BytesIO
from typing import Any

from backend.utils.html_sanitizer import sanitize_html_for_pdf


def deny_external_url_fetcher(url: str, **kwargs: Any) -> Any:
    """Allow only data: URIs; deny all other fetches (defense in depth)."""
    from weasyprint.urls import URLFetcherResponse, default_url_fetcher  # type: ignore[import-untyped]

    if str(url).strip().lower().startswith("data:"):
        return default_url_fetcher(url, **kwargs)
    return URLFetcherResponse(url, body=b"")


def write_pdf_sanitized(html_string: str) -> bytes:
    """Sanitize HTML then render PDF with network/file URL fetch denied."""
    from weasyprint import HTML

    cleaned = sanitize_html_for_pdf(html_string)
    pdf_buffer = BytesIO()
    HTML(string=cleaned, url_fetcher=deny_external_url_fetcher).write_pdf(pdf_buffer)
    return pdf_buffer.getvalue()
