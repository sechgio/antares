import base64

from backend.handlers import HANDLERS


def test_fichas_tecnicas_handlers_are_registered() -> None:
    assert "fichas_tecnicas_list" in HANDLERS
    assert "fichas_tecnicas_import_file" in HANDLERS
    assert "fichas_tecnicas_render_html" in HANDLERS
    assert "fichas_tecnicas_render_consolidated_html" in HANDLERS


def test_create_list_update_delete_clear(monkeypatch, tmp_path) -> None:
    from backend.core.fichas_tecnicas import database as db_module

    monkeypatch.setattr(db_module, "DEFAULT_DB_PATH", tmp_path / "fichas_tecnicas.json")
    db_module._db_instance = None

    created = HANDLERS["fichas_tecnicas_create"]({})["ficha"]
    assert created["id"].startswith("FT-")

    listed = HANDLERS["fichas_tecnicas_list"]({"summary": True})
    assert listed["total"] == 1
    assert listed["fichas"][0]["id"] == created["id"]

    created["cliente"] = "Cliente Demo"
    created["servicio"]["desinfeccion"] = True
    updated = HANDLERS["fichas_tecnicas_update"]({"id": created["id"], "ficha": created})["ficha"]
    assert updated["cliente"] == "Cliente Demo"
    assert updated["servicio"]["desinfeccion"] is True

    got = HANDLERS["fichas_tecnicas_get"]({"id": created["id"]})["ficha"]
    assert got["cliente"] == "Cliente Demo"

    deleted = HANDLERS["fichas_tecnicas_delete"]({"id": created["id"]})
    assert deleted["deleted_id"] == created["id"]
    assert HANDLERS["fichas_tecnicas_list"]({})["total"] == 0

    HANDLERS["fichas_tecnicas_create"]({})
    cleared = HANDLERS["fichas_tecnicas_clear"]({})
    assert cleared["deleted_count"] == 1
    assert HANDLERS["fichas_tecnicas_list"]({})["total"] == 0


def test_import_file_handler_imports_csv(monkeypatch, tmp_path) -> None:
    from backend.core.fichas_tecnicas import database as db_module

    monkeypatch.setattr(db_module, "DEFAULT_DB_PATH", tmp_path / "fichas_tecnicas.json")
    db_module._db_instance = None

    csv_body = (
        "os_numero;cliente;fecha;direccion;distrito;servicio_desinfeccion\n"
        "N° 00001;ACME;2026-01-15;Calle 1;Surco;X\n"
    )
    content = base64.b64encode(csv_body.encode("utf-8")).decode("ascii")

    result = HANDLERS["fichas_tecnicas_import_file"](
        {"filename": "fichas.csv", "content_b64": content}
    )

    assert result["imported_count"] == 1
    listed = HANDLERS["fichas_tecnicas_list"]({"summary": True})
    assert listed["fichas"][0]["id"] == "FT-00001"
    assert listed["fichas"][0]["cliente"] == "ACME"
    full = HANDLERS["fichas_tecnicas_get"]({"id": "FT-00001"})["ficha"]
    assert full["servicio"]["desinfeccion"] is True
    assert full["distrito"] == "Surco"


def test_import_csv_semicolon_with_few_columns(monkeypatch, tmp_path) -> None:
    """Regression: delimiter detection must not require >3 columns."""
    from backend.core.fichas_tecnicas import database as db_module

    monkeypatch.setattr(db_module, "DEFAULT_DB_PATH", tmp_path / "fichas_tecnicas.json")
    db_module._db_instance = None

    csv_body = "os_numero;cliente;servicio_desinfeccion\nN1;Importado;SI\n"
    content = base64.b64encode(csv_body.encode("utf-8")).decode("ascii")
    result = HANDLERS["fichas_tecnicas_import_file"](
        {"filename": "min.csv", "content_b64": content}
    )
    assert result["imported_count"] == 1
    full = HANDLERS["fichas_tecnicas_get"]({"id": "FT-00001"})["ficha"]
    assert full["cliente"] == "Importado"
    assert full["servicio"]["desinfeccion"] is True


def test_render_html_template_and_inline(monkeypatch, tmp_path) -> None:
    from backend.core.fichas_tecnicas import database as db_module

    monkeypatch.setattr(db_module, "DEFAULT_DB_PATH", tmp_path / "fichas_tecnicas.json")
    db_module._db_instance = None

    template = HANDLERS["fichas_tecnicas_render_html"]({"template": True})
    assert "FICHA TÉCNICA DE EVALUACIÓN DE ACTIVIDADES" in template["html"]
    assert template["filename"] == "plantilla_ficha_tecnica.pdf"
    assert "NOMBRE DEL CLIENTE" in template["html"]
    # Single-page A4, mirror of PreviewPanel (210x297 mm)
    assert "height: 297mm" in template["html"]
    assert "width: 210mm" in template["html"]
    assert "size: A4 portrait" in template["html"]
    assert "page-break-after: always" in template["html"]
    assert "Segoe UI" in template["html"]
    assert "padding: 8px" in template["html"]
    assert "border: 2px solid #333" in template["html"]

    created = HANDLERS["fichas_tecnicas_create"]({})["ficha"]
    created["cliente"] = "Cliente Inline"
    created["tratamiento"]["pulverizado"] = True
    rendered = HANDLERS["fichas_tecnicas_render_html"](
        {"id": created["id"], "ficha": created}
    )
    assert "Cliente Inline" in rendered["html"]
    assert 'class="checkbox checked"' in rendered["html"]


def test_render_consolidated_html(monkeypatch, tmp_path) -> None:
    from backend.core.fichas_tecnicas import database as db_module

    monkeypatch.setattr(db_module, "DEFAULT_DB_PATH", tmp_path / "fichas_tecnicas.json")
    db_module._db_instance = None

    a = HANDLERS["fichas_tecnicas_create"]({})["ficha"]
    b = HANDLERS["fichas_tecnicas_create"]({})["ficha"]
    a["cliente"] = "A"
    b["cliente"] = "B"
    HANDLERS["fichas_tecnicas_update"]({"id": a["id"], "ficha": a})
    HANDLERS["fichas_tecnicas_update"]({"id": b["id"], "ficha": b})

    result = HANDLERS["fichas_tecnicas_render_consolidated_html"]({})
    assert result["count"] == 2
    assert "Cliente" in result["html"] or "cliente" in result["html"].lower()
    assert result["html"].count('class="container"') == 2
