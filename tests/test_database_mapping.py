
from __future__ import annotations

import pytest

from backend.core import database as db


def _write_mapping_excel(path, rows, headers=("ID", "RENOMBRE")) -> None:
    import pandas as pd

    df = pd.DataFrame(rows, columns=list(headers))
    df.to_excel(path, index=False, engine="openpyxl")


class TestParseIdRenameMapping:
    def test_valid_excel_produces_dict(self, tmp_path) -> None:
        excel = tmp_path / "map.xlsx"
        _write_mapping_excel(excel, [
            ("IMG_0001.jpg", "fachada_norte.jpg"),
            ("IMG_0002.jpg", "fachada_sur"),
        ])
        result = db.parse_id_rename_mapping(str(excel))
        assert result == {
            "IMG_0001.jpg": "fachada_norte.jpg",
            "IMG_0002.jpg": "fachada_sur",
        }

    def test_headers_case_insensitive(self, tmp_path) -> None:
        excel = tmp_path / "map.xlsx"
        _write_mapping_excel(excel, [("A.jpg", "nuevo_a")], headers=("id", "Renombre"))
        result = db.parse_id_rename_mapping(str(excel))
        assert result == {"A.jpg": "nuevo_a"}

    def test_extra_column_auto_detects(self, tmp_path) -> None:
        excel = tmp_path / "map.xlsx"
        _write_mapping_excel(excel, [("A.jpg", "nuevo", "nota")], headers=("ID", "RENOMBRE", "Notas"))
        result = db.parse_id_rename_mapping(str(excel))
        assert result == {"A.jpg": "nuevo"}

    def test_extra_column_missing_rename_raises(self, tmp_path) -> None:
        excel = tmp_path / "map.xlsx"
        _write_mapping_excel(excel, [("A.jpg", "nuevo", "nota")], headers=("ID", "Nombre", "Notas"))
        with pytest.raises(ValueError, match="No se detectó una columna de nuevo nombre"):
            db.parse_id_rename_mapping(str(excel))

    def test_empty_id_raises_with_row(self, tmp_path) -> None:
        excel = tmp_path / "map.xlsx"
        _write_mapping_excel(excel, [("", "nuevo"), ("B.jpg", "b")])
        with pytest.raises(ValueError, match="fila 2"):
            db.parse_id_rename_mapping(str(excel))

    def test_duplicate_id_raises(self, tmp_path) -> None:
        excel = tmp_path / "map.xlsx"
        _write_mapping_excel(excel, [("A.jpg", "uno"), ("A.jpg", "dos")])
        with pytest.raises(ValueError, match="duplicado"):
            db.parse_id_rename_mapping(str(excel))

    def test_trims_whitespace(self, tmp_path) -> None:
        excel = tmp_path / "map.xlsx"
        _write_mapping_excel(excel, [("  A.jpg  ", "  nuevo_nombre  ")])
        result = db.parse_id_rename_mapping(str(excel))
        assert result == {"A.jpg": "nuevo_nombre"}

    def test_rename_header_alias(self, tmp_path) -> None:
        excel = tmp_path / "map.xlsx"
        _write_mapping_excel(excel, [("A.jpg", "nuevo")], headers=("ID", "Rename"))
        result = db.parse_id_rename_mapping(str(excel))
        assert result == {"A.jpg": "nuevo"}

    def test_rename_header_alias_con_guion_bajo(self, tmp_path) -> None:
        excel = tmp_path / "map.xlsx"
        _write_mapping_excel(excel, [("A.jpg", "nuevo")], headers=("ID", "new_name"))
        result = db.parse_id_rename_mapping(str(excel))
        assert result == {"A.jpg": "nuevo"}

        excel2 = tmp_path / "map2.xlsx"
        _write_mapping_excel(excel2, [("B.jpg", "nuevo")], headers=("ID", "nuevo_nombre"))
        result2 = db.parse_id_rename_mapping(str(excel2))
        assert result2 == {"B.jpg": "nuevo"}

    def test_explicit_columns_used(self, tmp_path) -> None:
        excel = tmp_path / "map.xlsx"
        _write_mapping_excel(
            excel,
            [("A.jpg", "desc_a", "nuevo_a")],
            headers=("Archivo", "Descripcion", "NuevoNombre"),
        )
        result = db.parse_id_rename_mapping(str(excel), id_column="archivo", rename_column="nuevonombre")
        assert result == {"A.jpg": "nuevo_a"}

    def test_auto_detect_custom_columns(self, tmp_path) -> None:
        excel = tmp_path / "map.xlsx"
        _write_mapping_excel(
            excel,
            [("A.jpg", "desc_a", "nuevo_a")],
            headers=("Codigo", "Descripcion", "NuevoNombre"),
        )
        result = db.parse_id_rename_mapping(str(excel))
        assert result == {"A.jpg": "nuevo_a"}

    def test_single_column_raises(self, tmp_path) -> None:
        excel = tmp_path / "map.xlsx"
        _write_mapping_excel(excel, [("A.jpg",)], headers=("ID",))
        with pytest.raises(ValueError, match="al menos 2 columnas"):
            db.parse_id_rename_mapping(str(excel))


class TestParseIdRenameMappingFull:

    def test_auto_detect_returns_chosen_columns(self, tmp_path) -> None:
        excel = tmp_path / "map.xlsx"
        _write_mapping_excel(
            excel,
            [("IMG_0001.jpg", "fachada", "categoria1", "fachada_norte")],
            headers=("ID", "TIPO", "CATEGORIA", "RENOMBRE"),
        )
        result = db.parse_id_rename_mapping_full(str(excel))
        assert result["mapping"] == {"IMG_0001.jpg": "fachada_norte"}
        assert result["id_column"] == "id"
        assert result["rename_column"] == "renombre"
        assert result["columns"] == ["id", "tipo", "categoria", "renombre"]

    def test_explicit_columns_returned_as_is(self, tmp_path) -> None:
        excel = tmp_path / "map.xlsx"
        _write_mapping_excel(
            excel,
            [("A.jpg", "desc_a", "nuevo_a")],
            headers=("Archivo", "Descripcion", "NuevoNombre"),
        )
        result = db.parse_id_rename_mapping_full(
            str(excel), id_column="archivo", rename_column="nuevonombre"
        )
        assert result["mapping"] == {"A.jpg": "nuevo_a"}
        assert result["id_column"] == "archivo"
        assert result["rename_column"] == "nuevonombre"
        assert result["columns"] == ["archivo", "descripcion", "nuevonombre"]

    def test_full_and_simple_are_consistent(self, tmp_path) -> None:
        excel = tmp_path / "map.xlsx"
        _write_mapping_excel(excel, [("A.jpg", "nuevo_a")])
        full = db.parse_id_rename_mapping_full(str(excel))
        simple = db.parse_id_rename_mapping(str(excel))
        assert full["mapping"] == simple


class TestDbParseMappingHandler:

    def test_auto_detect_response_includes_columns(self, tmp_path) -> None:
        from backend.handlers.database import db_parse_mapping

        excel = tmp_path / "map.xlsx"
        _write_mapping_excel(
            excel,
            [("IMG_0001.jpg", "fachada", "fachada_norte")],
            headers=("ID", "TIPO", "RENOMBRE"),
        )
        result = db_parse_mapping({"path": str(excel), "files": []})
        assert result["mapping"] == {"IMG_0001.jpg": "fachada_norte"}
        assert result["id_column"] == "id"
        assert result["rename_column"] == "renombre"
        assert result["columns"] == ["id", "tipo", "renombre"]

    def test_explicit_columns_echoed_in_response(self, tmp_path) -> None:
        from backend.handlers.database import db_parse_mapping

        excel = tmp_path / "map.xlsx"
        _write_mapping_excel(
            excel,
            [("A.jpg", "desc", "nuevo_a")],
            headers=("Archivo", "Descripcion", "NuevoNombre"),
        )
        result = db_parse_mapping(
            {"path": str(excel), "files": [], "id_column": "archivo", "rename_column": "nuevonombre"}
        )
        assert result["id_column"] == "archivo"
        assert result["rename_column"] == "nuevonombre"
        assert result["columns"] == ["archivo", "descripcion", "nuevonombre"]

