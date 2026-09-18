from __future__ import annotations

from pathlib import Path
from typing import Any

import openpyxl

from backend.handlers.spreadsheet import spreadsheet_get_rows, spreadsheet_parse


def _write_xlsx(path: Path, rows: list[list[Any]]) -> None:
    wb = openpyxl.Workbook()
    ws = wb.active
    assert ws is not None
    for row in rows:
        ws.append(list(row))
    wb.save(path)
    wb.close()


def test_large_spreadsheet_uses_indexed_spill(tmp_path: Path, monkeypatch) -> None:
    from backend.handlers import spreadsheet as ss

    monkeypatch.setattr(ss, "INLINE_RESULT_MAX_BYTES", 500)
    staged = tmp_path / "indexed.xlsx"
    rows = [[f"H{c}" for c in range(8)]] + [
        [str(r), "a", "b", "c", "d", "e", "f", "g"] for r in range(40)
    ]
    _write_xlsx(staged, rows)

    parsed = spreadsheet_parse({"path": str(staged), "format_hint": "xlsx"})

    spill_path = Path(parsed["result_path"])
    assert spill_path.read_bytes()[:16] == b"SQLite format 3\x00"


def test_indexed_spill_pages_without_reading_entire_file(tmp_path: Path, monkeypatch) -> None:
    from backend.handlers import spreadsheet as ss

    monkeypatch.setattr(ss, "INLINE_RESULT_MAX_BYTES", 500)
    staged = tmp_path / "paged.xlsx"
    rows = [["H1", "H2"]] + [[str(r), f"value-{r}"] for r in range(40)]
    _write_xlsx(staged, rows)
    parsed = spreadsheet_parse({"path": str(staged), "format_hint": "xlsx"})

    def fail_read_text(_self: Path, *_args: Any, **_kwargs: Any) -> str:
        raise AssertionError("indexed pagination must not read the entire spill")

    monkeypatch.setattr(Path, "read_text", fail_read_text)
    page = spreadsheet_get_rows(
        {"result_path": parsed["result_path"], "sheet_index": 0, "offset": 20, "limit": 5},
    )

    assert page["rows"] == [
        ["19", "value-19"],
        ["20", "value-20"],
        ["21", "value-21"],
        ["22", "value-22"],
        ["23", "value-23"],
    ]
    assert page["total"] == 41
    assert page["has_more"] is True


def test_large_parse_does_not_serialize_full_workbook(tmp_path: Path, monkeypatch) -> None:
    from backend.core import spreadsheet_spill
    from backend.handlers import spreadsheet as ss

    monkeypatch.setattr(ss, "INLINE_RESULT_MAX_BYTES", 500)
    staged = tmp_path / "bounded.xlsx"
    rows = [["H1", "H2"]] + [[str(r), f"value-{r}"] for r in range(100)]
    _write_xlsx(staged, rows)
    real_dumps = spreadsheet_spill.json.dumps
    serialized_workbooks = 0

    def tracking_dumps(value: Any, *args: Any, **kwargs: Any) -> str:
        nonlocal serialized_workbooks
        if isinstance(value, dict) and isinstance(value.get("sheets"), list):
            serialized_workbooks += 1
        return real_dumps(value, *args, **kwargs)

    monkeypatch.setattr(spreadsheet_spill.json, "dumps", tracking_dumps)

    parsed = spreadsheet_parse({"path": str(staged), "format_hint": "xlsx"})

    assert "result_path" in parsed
    assert serialized_workbooks == 0
