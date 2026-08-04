import base64

from backend.handlers import HANDLERS


def _reset_db(monkeypatch, tmp_path):
    from backend.core.informes_v2 import database as db_module

    monkeypatch.setattr(db_module, "DEFAULT_DB_PATH", tmp_path / "informes_v2.json")
    db_module._db_instance = None


def test_informes_v2_handlers_are_registered() -> None:
    assert "informes_v2_list" in HANDLERS
    assert "informes_v2_import_file" in HANDLERS
    assert "informes_v2_download_template" in HANDLERS
    assert "informes_v2_render_html" in HANDLERS
    assert "informes_v2_render_consolidated_html" in HANDLERS


def test_create_list_update_delete_clear(monkeypatch, tmp_path) -> None:
    _reset_db(monkeypatch, tmp_path)

    created = HANDLERS["informes_v2_create"]({})["report"]
    assert created["id"].startswith("IV2-")

    listed = HANDLERS["informes_v2_list"]({"summary": True})
    assert len(listed["reports"]) == 1
    assert listed["reports"][0]["id"] == created["id"]

    created["header"]["estacion"] = "R-900"
    created["header"]["photo_id"] = "R-900"
    updated = HANDLERS["informes_v2_update"]({"id": created["id"], "report": created})["report"]
    assert updated["header"]["estacion"] == "R-900"

    got = HANDLERS["informes_v2_get"]({"id": created["id"]})["report"]
    assert got["header"]["photo_id"] == "R-900"

    deleted = HANDLERS["informes_v2_delete"]({"id": created["id"]})
    assert deleted["deleted_id"] == created["id"]
    assert HANDLERS["informes_v2_list"]({})["reports"] == []

    HANDLERS["informes_v2_create"]({})
    cleared = HANDLERS["informes_v2_clear"]({})
    assert cleared["deleted_count"] == 1


def test_import_file_and_download_template(monkeypatch, tmp_path) -> None:
    _reset_db(monkeypatch, tmp_path)
    content = base64.b64encode(
        b"ID;Estacion;Tipo;Volumen\nR-1;Estacion Uno;ELEVADO;100\n"
    ).decode("ascii")

    result = HANDLERS["informes_v2_import_file"]({"filename": "datos.csv", "content_b64": content})
    assert result["imported_count"] == 1
    assert HANDLERS["informes_v2_list"]({"summary": True})["reports"][0]["header"]["photo_id"] == "R-1"

    template = HANDLERS["informes_v2_download_template"]({})
    assert template["filename"] == "informes_v2_plantilla.xlsx"
    assert template["content_b64"]
    raw = base64.b64decode(template["content_b64"])
    assert raw[:2] == b"PK"


def test_render_html_includes_photo_grid(monkeypatch, tmp_path) -> None:
    _reset_db(monkeypatch, tmp_path)
    report = HANDLERS["informes_v2_create"]({})["report"]
    report["header"]["estacion"] = "Demo"
    result = HANDLERS["informes_v2_render_html"](
        {
            "report": report,
            "images": [{"path": "data:image/png;base64,aaa", "name": "Demo-1.png"}],
        }
    )
    assert "iv2-photo-grid" in result["html"]
    assert "Demo" in result["html"]
    assert "data:image/png;base64,aaa" in result["html"]
    assert result["filename"].startswith("informe_v2_")
