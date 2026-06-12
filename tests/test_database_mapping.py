"""Tests para parse_id_rename_mapping (Excel ID → RENOMBRE)."""

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

    def test_extra_column_raises(self, tmp_path) -> None:
        excel = tmp_path / "map.xlsx"
        _write_mapping_excel(excel, [("A.jpg", "nuevo", "nota")], headers=("ID", "RENOMBRE", "Notas"))
        with pytest.raises(ValueError, match="exactamente 2 columnas"):
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


def test_mapping_template_parses(tmp_path) -> None:
    excel = tmp_path / "plantilla-mapeo.xlsx"
    db.generar_plantilla_mapeo_excel(str(excel))
    result = db.parse_id_rename_mapping(str(excel))
    assert len(result) == 3
    assert result["IMG_0001.jpg"] == "fachada_norte"
