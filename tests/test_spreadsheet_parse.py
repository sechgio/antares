"""Regresión: spreadsheet_parse con staging .tmp, fechas y format_hint."""

from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path
from typing import Any

import openpyxl

from backend.handlers.spreadsheet import spreadsheet_parse


def _write_xlsx(path: Path, rows: list[list[Any]]) -> None:
    wb = openpyxl.Workbook()
    ws = wb.active
    assert ws is not None
    for row in rows:
        ws.append(list(row))
    wb.save(path)
    wb.close()


def test_parse_xlsx_with_tmp_suffix_via_format_hint(tmp_path: Path) -> None:
    """Staging histórico guardaba datos.xlsx.tmp; format_hint debe bastar."""
    staged = tmp_path / "token_datos.xlsx.tmp"
    _write_xlsx(
        staged,
        [
            ["SGIO", "DISTRITO"],
            ["123", "ATE"],
            ["456", "LIMA"],
        ],
    )

    result = spreadsheet_parse({"path": str(staged), "format_hint": "xlsx"})

    assert result["workbookName"]
    assert len(result["sheets"]) == 1
    assert result["sheets"][0]["rows"][0] == ["SGIO", "DISTRITO"]
    assert result["sheets"][0]["rows"][1] == ["123", "ATE"]


def test_parse_xlsx_with_tmp_suffix_via_token_name(tmp_path: Path) -> None:
    """Sin format_hint, el nombre original del token define el formato."""
    staged = tmp_path / "antares-staged_upload.tmp"
    _write_xlsx(
        staged,
        [
            ["OT", "ZONA"],
            ["9", "Norte"],
        ],
    )

    result = spreadsheet_parse(
        {
            "_resolved_file_token_path": str(staged),
            "_resolved_file_token_name": "reporte.xlsx",
        },
    )

    assert result["workbookName"] == "reporte.xlsx"
    assert result["sheets"][0]["rows"][1] == ["9", "Norte"]


def test_parse_xlsx_datetime_cells_are_json_serializable(tmp_path: Path) -> None:
    """openpyxl puede devolver datetime; el resultado debe ser JSON-safe."""
    staged = tmp_path / "fechas.xlsx"
    wb = openpyxl.Workbook()
    ws = wb.active
    assert ws is not None
    ws.append(["FECHA CORTE", "SGIO"])
    ws.append([datetime(2026, 3, 15, 8, 30, 0), "100"])
    ws.append([date(2026, 4, 1), "200"])
    wb.save(staged)
    wb.close()

    result = spreadsheet_parse({"path": str(staged), "format_hint": "xlsx"})

    json.dumps(result)  # no debe lanzar TypeError
    fecha_1 = result["sheets"][0]["rows"][1][0]
    fecha_2 = result["sheets"][0]["rows"][2][0]
    assert isinstance(fecha_1, str)
    assert isinstance(fecha_2, str)
    assert "2026" in fecha_1
    assert "2026" in fecha_2


def test_parse_xlsx_wrong_suffix_does_not_read_neighbor(tmp_path: Path) -> None:
    """Copia/renombre temporal no debe reutilizar un .xlsx vecino distinto."""
    neighbor = tmp_path / "upload.xlsx"
    _write_xlsx(neighbor, [["VECINO"], ["999"]])

    staged = tmp_path / "upload.bin"
    _write_xlsx(staged, [["ORIGEN"], ["1"]])

    result = spreadsheet_parse({"path": str(staged), "format_hint": "xlsx"})

    assert result["sheets"][0]["rows"][0] == ["ORIGEN"]
    assert result["sheets"][0]["rows"][1] == ["1"]


def test_parse_csv_via_hint_with_tmp_suffix(tmp_path: Path) -> None:
    staged = tmp_path / "datos.csv.tmp"
    staged.write_text("A,B\n1,2\n", encoding="utf-8-sig")

    result = spreadsheet_parse({"path": str(staged), "format_hint": "csv"})

    assert result["sheets"][0]["rows"] == [["A", "B"], ["1", "2"]]


def test_parse_spills_large_result_to_disk(tmp_path: Path, monkeypatch) -> None:
    """Large grids must not travel as inline JSON on the IPC pipe."""
    from backend.handlers import spreadsheet as ss

    monkeypatch.setattr(ss, "INLINE_RESULT_MAX_BYTES", 2_000)

    staged = tmp_path / "grande.xlsx"
    rows = [["C" + str(c) for c in range(20)] for _ in range(50)]
    rows[0] = [f"H{c}" for c in range(20)]
    _write_xlsx(staged, rows)

    result = spreadsheet_parse({"path": str(staged), "format_hint": "xlsx"})

    assert result["sheets"] == []
    assert "result_path" in result
    assert Path(result["result_path"]).is_file()
    spilled = json.loads(Path(result["result_path"]).read_text(encoding="utf-8"))
    assert len(spilled["sheets"][0]["rows"]) == 50
    assert result["sheet_meta"][0]["rowCount"] == 50
    assert result["workbookName"]


def test_get_rows_pages_spilled_cache(tmp_path: Path, monkeypatch) -> None:
    from backend.handlers import spreadsheet as ss
    from backend.handlers.spreadsheet import spreadsheet_get_rows

    monkeypatch.setattr(ss, "INLINE_RESULT_MAX_BYTES", 500)
    staged = tmp_path / "page.xlsx"
    rows = [[f"H{c}" for c in range(8)]] + [[str(r), "a", "b", "c", "d", "e", "f", "g"] for r in range(40)]
    _write_xlsx(staged, rows)

    parsed = spreadsheet_parse({"path": str(staged), "format_hint": "xlsx"})
    assert "result_path" in parsed, parsed
    page = spreadsheet_get_rows(
        {
            "result_path": parsed["result_path"],
            "sheet_index": 0,
            "offset": 0,
            "limit": 10,
        },
    )
    assert page["total"] == 41
    assert len(page["rows"]) == 10
    assert page["has_more"] is True
    assert page["rows"][0][0] == "H0"

    page2 = spreadsheet_get_rows(
        {
            "result_path": parsed["result_path"],
            "offset": 10,
            "limit": 10,
        },
    )
    assert len(page2["rows"]) == 10
    assert page2["rows"][0][0] == "9"
