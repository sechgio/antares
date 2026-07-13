"""Shared write_pdf_sanitized helper characterization."""

from __future__ import annotations

from backend.utils.pdf_html import deny_external_url_fetcher, write_pdf_sanitized


def test_deny_external_url_fetcher_blocks_http() -> None:
    resp = deny_external_url_fetcher("https://evil.example/x.png")
    # Empty body means WeasyPrint gets no remote bytes.
    file_obj = getattr(resp, "_file_obj", None)
    assert file_obj is not None
    assert file_obj.read() == b""


def test_write_pdf_sanitized_produces_pdf_from_data_uri() -> None:
    tiny = (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
    html = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'></head>"
        f"<body><img src='data:image/png;base64,{tiny}'/></body></html>"
    )
    pdf = write_pdf_sanitized(html)
    assert pdf.startswith(b"%PDF")
