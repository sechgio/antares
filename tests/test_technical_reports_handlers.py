import base64

from backend.handlers import HANDLERS
from backend.handlers.technical_reports import _sanitize_html_for_pdf


def test_technical_reports_handlers_are_registered(monkeypatch, tmp_path) -> None:
    from backend.core.technical_reports import database as db_module

    monkeypatch.setattr(db_module, "DEFAULT_DB_PATH", tmp_path / "technical_reports.json")
    assert "technical_reports_list" in HANDLERS
    assert "technical_reports_import_file" in HANDLERS


def test_import_file_handler_imports_csv(monkeypatch, tmp_path) -> None:
    from backend.core.technical_reports import database as db_module

    monkeypatch.setattr(db_module, "DEFAULT_DB_PATH", tmp_path / "technical_reports.json")
    content = base64.b64encode(b"Informe;CS;Codigo;Tipo\n1;SUR;RES-1;ELEVADO\n").decode("ascii")

    result = HANDLERS["technical_reports_import_file"]({"filename": "datos.csv", "content_b64": content})

    assert result["imported_count"] == 1
    assert HANDLERS["technical_reports_list"]({"summary": True})["reports"][0]["id"] == "RPT-0001"


def test_html_pdf_sanitizer_blocks_remote_and_local_resource_urls() -> None:
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
      </body>
    </html>
    """

    sanitized = _sanitize_html_for_pdf(html)

    assert "Content-Security-Policy" in sanitized
    assert "<script" not in sanitized.lower()
    assert "<iframe" not in sanitized.lower()
    assert "file:///etc/passwd" not in sanitized
    assert "https://example.com/a.png" not in sanitized
    assert "url(data:image/png;base64,AAAA)" in sanitized
