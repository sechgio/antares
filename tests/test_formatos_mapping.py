import json

from backend.core import formatos


def test_update_mapping_persists_catalog_without_closed_file(tmp_path, monkeypatch):
    catalog_path = tmp_path / "catalog.json"
    mapping = {
        "page": 0,
        "x": 535,
        "y": 25,
        "width": 150,
        "height": 24,
        "font_size": 15,
        "font_name": "Helvetica-Bold",
        "color_r": 0.1176,
        "color_g": 0.2275,
        "color_b": 0.5412,
        "padding": 5,
        "blank_x": None,
        "blank_y": None,
        "blank_width": None,
        "blank_height": None,
        "redraw_top_border": False,
        "redraw_ot_badge": False,
        "blank_mcids": None,
    }
    entry = {
        "id": "upload-test",
        "nombre": "Upload Test",
        "origen": "uploaded",
        "storage_path": "upload-test.pdf",
        "enabled": True,
        "persisted": True,
        "strategy": formatos.SIMPLE_OVERLAY,
        "mapping": None,
        "filename_pattern": "upload-test_{desde}.pdf",
        "max_pages": 500,
        "number_min": 1,
        "number_max": 9999999,
        "has_mapping": False,
    }

    monkeypatch.setattr(formatos, "_CATALOG_PATH", catalog_path)
    monkeypatch.setattr(formatos, "_formats", {"upload-test": entry})

    result = formatos.update_mapping("upload-test", mapping)

    assert result is not None
    assert result["mapping"] == mapping
    assert result["has_mapping"] is True
    assert json.loads(catalog_path.read_text(encoding="utf-8"))[0]["mapping"] == mapping
