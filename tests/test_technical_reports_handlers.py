import base64

from backend.handlers import HANDLERS


def test_technical_reports_handlers_are_registered(monkeypatch, tmp_path):
    from backend.core.technical_reports import database as db_module

    monkeypatch.setattr(db_module, "DEFAULT_DB_PATH", tmp_path / "technical_reports.json")
    assert "technical_reports_list" in HANDLERS
    assert "technical_reports_import_file" in HANDLERS


def test_import_file_handler_imports_csv(monkeypatch, tmp_path):
    from backend.core.technical_reports import database as db_module

    monkeypatch.setattr(db_module, "DEFAULT_DB_PATH", tmp_path / "technical_reports.json")
    content = base64.b64encode(b"Informe;CS;Codigo;Tipo\n1;SUR;RES-1;ELEVADO\n").decode("ascii")

    result = HANDLERS["technical_reports_import_file"]({"filename": "datos.csv", "content_b64": content})

    assert result["imported_count"] == 1
    assert HANDLERS["technical_reports_list"]({"summary": True})["reports"][0]["id"] == "RPT-0001"
