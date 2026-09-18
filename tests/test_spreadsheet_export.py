from __future__ import annotations

import base64
import io
import sys
import types
from pathlib import Path

import pytest

import backend.handlers.spreadsheet as ss


def test_export_volantes_template_devuelve_b64_sin_path() -> None:
    result = ss.spreadsheet_export_volantes_template({})
    assert result["filename"] == "plantilla-volantes.xlsx"
    payload = base64.b64decode(result["content_b64"])
    assert payload[:2] == b"PK"  # xlsx es zip

    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(payload))
    ws = wb.active
    headers = [c.value for c in ws[1]]
    assert headers == [
        "item",
        "sgio",
        "distrito",
        "fecha",
        "hora_inicio",
        "hora_fin",
        "reservorio",
        "sector",
        "zonas_afectadas",
    ]


def test_export_volantes_template_escribe_a_output_path(tmp_path: Path) -> None:
    dest = tmp_path / "out" / "plantilla.xlsx"
    result = ss.spreadsheet_export_volantes_template({"output_path": str(dest)})
    written = Path(result["path"])
    assert written.exists()
    assert written.name == "plantilla.xlsx"
    assert result["filename"] == "plantilla.xlsx"


def test_export_volantes_template_respeta_overwrite(tmp_path: Path) -> None:
    dest = tmp_path / "plantilla.xlsx"
    ss.spreadsheet_export_volantes_template({"output_path": str(dest)})
    with pytest.raises(FileExistsError):
        ss.spreadsheet_export_volantes_template({"output_path": str(dest)})
    result = ss.spreadsheet_export_volantes_template({"output_path": str(dest), "overwrite": True})
    assert Path(result["path"]).exists()


def test_export_volantes_template_sin_pandas_lanza_importerror(monkeypatch) -> None:
    monkeypatch.setitem(sys.modules, "pandas", None)
    with pytest.raises(ImportError, match="pandas"):
        ss.spreadsheet_export_volantes_template({})


def _fake_xls_book(monkeypatch, sheets: list[tuple[str, list[list[object]]]]) -> None:
    """Simula xlrd.open_workbook con un libro falso."""

    class _Sheet:
        def __init__(self, name: str, rows: list[list[object]]) -> None:
            self.name = name
            self.nrows = len(rows)
            self.ncols = max((len(r) for r in rows), default=0)
            self._rows = rows

        def cell_value(self, r: int, c: int):
            row = self._rows[r]
            return row[c] if c < len(row) else ""

    class _Book:
        def __init__(self) -> None:
            self.nsheets = len(sheets)
            self._sheets = [_Sheet(n, rs) for n, rs in sheets]

        def sheet_by_index(self, idx: int):
            return self._sheets[idx]

    xlrd = types.ModuleType("xlrd")
    xlrd.open_workbook = lambda _path: _Book()  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "xlrd", xlrd)


def _builder(tmp_path: Path) -> ss.SpreadsheetResultBuilder:
    return ss.SpreadsheetResultBuilder("wb", inline_max_bytes=10_000_000, spill_dir=tmp_path)


def test_parse_xls_recorre_hojas_y_serializa(monkeypatch, tmp_path) -> None:
    _fake_xls_book(
        monkeypatch,
        [
            ("H1", [["a", "b"], [1, None]]),
            ("H2", [["x"], []]),
        ],
    )
    result = _builder(tmp_path)
    warnings = ss._parse_xls(Path("fake.xls"), result)
    assert warnings == []


def test_parse_xls_trunca_hojas_sobre_el_limite(monkeypatch, tmp_path) -> None:
    sheets = [(f"H{i}", [["x"]]) for i in range(ss.MAX_SHEETS + 2)]
    _fake_xls_book(monkeypatch, sheets)
    result = _builder(tmp_path)
    warnings = ss._parse_xls(Path("fake.xls"), result)
    assert warnings == [f"Se truncó a {ss.MAX_SHEETS} hojas"]


def test_parse_xls_rompe_al_superar_max_celdas(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(ss, "MAX_CELLS", 3)
    _fake_xls_book(monkeypatch, [("H1", [["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]])])
    result = _builder(tmp_path)
    warnings = ss._parse_xls(Path("fake.xls"), result)
    assert warnings == ["Se alcanzó el límite de celdas (2M)"]
