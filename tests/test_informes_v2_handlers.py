import base64

import pytest

from backend.handlers import HANDLERS


def _reset_db(monkeypatch, tmp_path):
    from backend.core.informes_v2 import database as db_module

    monkeypatch.setattr(db_module, "DEFAULT_DB_PATH", tmp_path / "informes_v2.json")
    db_module._db_singleton.reset()


def test_informes_v2_handlers_are_registered() -> None:
    assert "informes_v2_list" in HANDLERS
    assert "informes_v2_import_file" in HANDLERS
    assert "informes_v2_download_template" in HANDLERS
    assert "informes_v2_render_html" in HANDLERS
    assert "informes_v2_render_consolidated_html" in HANDLERS


def test_create_list_update_delete_clear(monkeypatch, tmp_path) -> None:
    _reset_db(monkeypatch, tmp_path)

    created = HANDLERS["informes_v2_create"]({})["item"]
    assert created["id"].startswith("IV2-")

    listed = HANDLERS["informes_v2_list"]({"summary": True})
    assert len(listed["items"]) == 1
    assert listed["items"][0]["id"] == created["id"]

    created["header"]["estacion"] = "R-900"
    created["header"]["photo_id"] = "R-900"
    updated = HANDLERS["informes_v2_update"]({"id": created["id"], "report": created})["item"]
    assert updated["header"]["estacion"] == "R-900"

    got = HANDLERS["informes_v2_get"]({"id": created["id"]})["item"]
    assert got["header"]["photo_id"] == "R-900"

    deleted = HANDLERS["informes_v2_delete"]({"id": created["id"]})
    assert deleted["deleted_id"] == created["id"]
    assert HANDLERS["informes_v2_list"]({})["items"] == []

    HANDLERS["informes_v2_create"]({})
    cleared = HANDLERS["informes_v2_clear"]({})
    assert cleared["deleted_count"] == 1
    assert cleared["message"] == "Se eliminaron 1 informes"


def test_crud_errors_preserve_public_messages(monkeypatch, tmp_path) -> None:
    _reset_db(monkeypatch, tmp_path)

    with pytest.raises(ValueError, match="Informe no encontrado: missing"):
        HANDLERS["informes_v2_get"]({"id": "missing"})
    with pytest.raises(ValueError, match="Informe no encontrado: missing"):
        HANDLERS["informes_v2_update"]({"id": "missing", "report": {}})
    with pytest.raises(ValueError, match="Informe no encontrado: missing"):
        HANDLERS["informes_v2_delete"]({"id": "missing"})
    with pytest.raises(ValueError, match="id y report son requeridos"):
        HANDLERS["informes_v2_update"]({"id": "missing"})


def test_import_file_and_download_template(monkeypatch, tmp_path) -> None:
    _reset_db(monkeypatch, tmp_path)
    content = base64.b64encode(
        b"ID;Estacion;Tipo;Volumen\nR-1;Estacion Uno;ELEVADO;100\n"
    ).decode("ascii")

    result = HANDLERS["informes_v2_import_file"]({"filename": "datos.csv", "content_b64": content})
    assert result["imported_count"] == 1
    assert HANDLERS["informes_v2_list"]({"summary": True})["items"][0]["header"]["photo_id"] == "R-1"

    # Con plantilla seleccionada, las hojas importadas nacen con esa plantilla.
    result = HANDLERS["informes_v2_import_file"](
        {"filename": "datos.csv", "content_b64": content, "plantilla": "reservorios2"}
    )
    assert result["imported_count"] == 1
    imported = HANDLERS["informes_v2_list"]({})["items"][0]
    assert imported["plantilla"] == "reservorios2"

    template = HANDLERS["informes_v2_download_template"]({})
    assert template["filename"] == "informes_v2_plantilla.xlsx"
    assert template["content_b64"]
    raw = base64.b64decode(template["content_b64"])
    assert raw[:2] == b"PK"

    new_template = HANDLERS["informes_v2_download_template"]({"plantilla": "reservorios2"})
    assert new_template["filename"] == "informes_v2_plantilla_nueva.xlsx"
    assert base64.b64decode(new_template["content_b64"])[:2] == b"PK"


def test_render_html_includes_photo_grid(monkeypatch, tmp_path) -> None:
    _reset_db(monkeypatch, tmp_path)
    report = HANDLERS["informes_v2_create"]({})["item"]
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


def test_render_reservorios2_html_and_persistence(monkeypatch, tmp_path) -> None:
    _reset_db(monkeypatch, tmp_path)
    report = HANDLERS["informes_v2_create"]({})["item"]
    assert report["plantilla"] == "clasica"

    report["plantilla"] = "reservorios2"
    report["header"]["cod_infraestructura"] = "CI-9"
    report["reservorios2"]["inspeccion"]["descarga"]["critico"] = True
    report["reservorios2"]["valvulas"]["desague"]["diametros"]["3"] = 4
    saved = HANDLERS["informes_v2_update"]({"id": report["id"], "report": report})["item"]
    assert saved["plantilla"] == "reservorios2"
    assert saved["reservorios2"]["valvulas"]["desague"]["diametros"]["3"] == 4

    got = HANDLERS["informes_v2_get"]({"id": report["id"]})["item"]
    assert got["header"]["cod_infraestructura"] == "CI-9"
    assert got["reservorios2"]["inspeccion"]["descarga"]["critico"] is True

    result = HANDLERS["informes_v2_render_html"]({"report": got})
    assert "DIÁMETRO DE VÁLVULAS" in result["html"]
    assert "CI-9" not in result["html"]
    assert "DIAMETRO DE TUBERIA" not in result["html"]


def test_summary_list_does_not_copy_full_reports(monkeypatch, tmp_path) -> None:
    from backend.core.informes_v2.database import get_informes_v2_db

    _reset_db(monkeypatch, tmp_path)
    created = HANDLERS["informes_v2_create"]({})["item"]
    created["header"]["estacion"] = "Estación filtrada"
    HANDLERS["informes_v2_update"]({"id": created["id"], "report": created})
    db = get_informes_v2_db()

    def fail_get_all():
        raise AssertionError("summary listing must not copy complete reports")

    monkeypatch.setattr(db, "get_all", fail_get_all)

    listed = HANDLERS["informes_v2_list"]({"summary": True, "q": "filtrada"})

    assert [item["id"] for item in listed["items"]] == [created["id"]]


def test_selected_consolidated_export_reads_only_selected_reports(monkeypatch, tmp_path) -> None:
    from backend.core.informes_v2.database import get_informes_v2_db

    _reset_db(monkeypatch, tmp_path)
    selected = HANDLERS["informes_v2_create"]({})["item"]
    HANDLERS["informes_v2_create"]({})
    db = get_informes_v2_db()

    def fail_get_all():
        raise AssertionError("selected export must not copy every report")

    monkeypatch.setattr(db, "get_all", fail_get_all)

    rendered = HANDLERS["informes_v2_render_consolidated_html"]({"report_ids": [selected["id"]]})

    assert rendered["count"] == 1
