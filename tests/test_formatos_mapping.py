import json

import pytest

from backend.core import formatos


def test_update_mapping_persists_catalog_without_closed_file(tmp_path, monkeypatch) -> None:
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


def test_update_mapping_acota_valores_imposibles(tmp_path, monkeypatch) -> None:
    catalog_path = tmp_path / "catalog.json"
    entry = {**formatos._BUILTIN_FORMATS[0], "origen": "uploaded", "persisted": True}
    monkeypatch.setattr(formatos, "_CATALOG_PATH", catalog_path)
    monkeypatch.setattr(formatos, "_formats", {"upload-test": entry})

    result = formatos.update_mapping(
        "upload-test",
        {
            "page": -9,
            "x": "abc",
            "y": float("inf"),
            "font_size": 0,
            "font_name": "Courier/Bold\n",
            "color_r": 5,
            "color_g": -1,
            "padding": 10**6,
            "blank_x": None,
            "blank_mcids": ["x", 3, 10**9],
            "redraw_top_border": 1,
            "clave_ajena": "no debe persistirse",
        },
    )

    assert result is not None
    stored = result["mapping"]
    assert stored["page"] == 0
    assert stored["x"] == 0
    assert stored["y"] == 0
    assert stored["font_size"] == 1
    assert stored["font_name"] == "CourierBold"
    assert stored["color_r"] == 1
    assert stored["color_g"] == 0
    assert stored["padding"] == 12
    assert stored["blank_mcids"] == [0, 3, 1000000]
    assert stored["redraw_top_border"] is True
    assert "clave_ajena" not in stored
    assert json.loads(catalog_path.read_text(encoding="utf-8"))[0]["mapping"] == stored


def test_update_mapping_rechaza_un_mapping_que_no_es_objeto(tmp_path, monkeypatch) -> None:
    entry = {**formatos._BUILTIN_FORMATS[0], "origen": "uploaded", "persisted": False}
    monkeypatch.setattr(formatos, "_CATALOG_PATH", tmp_path / "catalog.json")
    monkeypatch.setattr(formatos, "_formats", {"upload-test": entry})

    with pytest.raises(ValueError, match="mapping"):
        formatos.update_mapping("upload-test", ["x"])
    with pytest.raises(ValueError, match="mapping"):
        formatos.update_mapping("upload-test", None)
