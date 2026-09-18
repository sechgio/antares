from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from backend.core.spreadsheet_spill import (
    SpreadsheetResultBuilder,
    is_indexed_sheet_cache,
    load_indexed_sheet_page,
)
from backend.handlers.spreadsheet import spreadsheet_get_rows


def _make_spill(spill_dir: Path, *, sheets: dict[str, list[list[object]]] | None = None) -> Path:
    builder = SpreadsheetResultBuilder("wb.xlsx", inline_max_bytes=1, spill_dir=spill_dir)
    for name, rows in ({"Hoja1": [["a", "b"], ["1", "2"]]} if sheets is None else sheets).items():
        idx = builder.start_sheet(name)
        for row in rows:
            builder.append_row(idx, row)
    result = builder.finish([])
    return Path(result["result_path"])


def test_load_indexed_sheet_page_missing_file(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        load_indexed_sheet_page(
            tmp_path / "nope.sqlite3",
            sheet_name=None,
            sheet_index=None,
            offset=0,
            limit=10,
        )


def test_load_indexed_sheet_page_rejects_symlink(tmp_path: Path) -> None:
    spill = _make_spill(tmp_path)
    link = tmp_path / "linked.sqlite3"
    try:
        link.symlink_to(spill)
    except (OSError, NotImplementedError):
        pytest.skip("sin privilegios para crear symlinks")
    with pytest.raises(ValueError, match="symlink"):
        load_indexed_sheet_page(link, sheet_name=None, sheet_index=None, offset=0, limit=10)


def test_load_indexed_sheet_page_corrupt_database(tmp_path: Path) -> None:
    fake = tmp_path / "corrupt.sqlite3"
    fake.write_bytes(b"SQLite format 3\x00" + b"not-a-real-db" * 16)
    with pytest.raises(ValueError, match="corrupto"):
        load_indexed_sheet_page(fake, sheet_name=None, sheet_index=None, offset=0, limit=10)


def test_load_indexed_sheet_page_invalid_sheet_index(tmp_path: Path) -> None:
    spill = _make_spill(tmp_path)
    with pytest.raises(ValueError, match="sheet_index"):
        load_indexed_sheet_page(
            spill, sheet_name=None, sheet_index="abc", offset=0, limit=10,
        )


def test_load_indexed_sheet_page_unknown_sheet(tmp_path: Path) -> None:
    spill = _make_spill(tmp_path)
    with pytest.raises(ValueError, match="hoja no encontrada"):
        load_indexed_sheet_page(
            spill, sheet_name="Inexistente", sheet_index=None, offset=0, limit=10,
        )
    with pytest.raises(ValueError, match="hoja no encontrada"):
        load_indexed_sheet_page(
            spill, sheet_name=None, sheet_index=99, offset=0, limit=10,
        )


def test_load_indexed_sheet_page_empty_cache(tmp_path: Path) -> None:
    spill = _make_spill(tmp_path, sheets={})
    page = load_indexed_sheet_page(spill, sheet_name="Cualquiera", sheet_index=None, offset=0, limit=10)
    assert page == {"name": "", "rows": [], "offset": 0, "limit": 0, "total": 0, "has_more": False}


def test_load_indexed_sheet_page_defaults_to_first_sheet(tmp_path: Path) -> None:
    spill = _make_spill(tmp_path, sheets={"A": [["a1"]], "B": [["b1"]]})
    page = load_indexed_sheet_page(spill, sheet_name=None, sheet_index=None, offset=0, limit=10)
    assert page["name"] == "A"
    assert page["rows"] == [["a1"]]


def test_load_indexed_sheet_page_offset_beyond_total(tmp_path: Path) -> None:
    spill = _make_spill(tmp_path)
    page = load_indexed_sheet_page(spill, sheet_name=None, sheet_index=None, offset=999, limit=10)
    assert page["rows"] == []
    assert page["has_more"] is False
    assert page["total"] == 2


def test_is_indexed_sheet_cache(tmp_path: Path) -> None:
    spill = _make_spill(tmp_path)
    assert is_indexed_sheet_cache(spill) is True

    json_cache = tmp_path / "cache.json"
    json_cache.write_text('{"sheets": []}', encoding="utf-8")
    assert is_indexed_sheet_cache(json_cache) is False

    assert is_indexed_sheet_cache(tmp_path / "missing") is False


def test_builder_abort_removes_spill_file(tmp_path: Path) -> None:
    builder = SpreadsheetResultBuilder("wb.xlsx", inline_max_bytes=1, spill_dir=tmp_path)
    idx = builder.start_sheet("Hoja1")
    builder.append_row(idx, ["a"])
    spill = builder._path
    assert spill is not None and spill.is_file()

    builder.abort()

    assert not spill.exists()


def test_builder_abort_before_spill_is_noop(tmp_path: Path) -> None:
    builder = SpreadsheetResultBuilder("wb.xlsx", inline_max_bytes=10_000, spill_dir=tmp_path)
    builder.abort()
    assert list(tmp_path.iterdir()) == []


def test_finish_spills_when_final_payload_exceeds_limit(tmp_path: Path) -> None:
    builder = SpreadsheetResultBuilder("wb.xlsx", inline_max_bytes=200, spill_dir=tmp_path)
    idx = builder.start_sheet("Hoja1")
    builder.append_row(idx, ["a"])

    result = builder.finish(["x" * 500])

    assert "result_path" in result
    assert result["sheets"] == []
    page = load_indexed_sheet_page(
        Path(result["result_path"]), sheet_name=None, sheet_index=None, offset=0, limit=10,
    )
    assert page["rows"] == [["a"]]


def test_rows_written_after_spill_reach_sqlite(tmp_path: Path) -> None:
    builder = SpreadsheetResultBuilder("wb.xlsx", inline_max_bytes=60, spill_dir=tmp_path)
    idx_a = builder.start_sheet("A")
    builder.append_row(idx_a, ["before-spill"])
    idx_b = builder.start_sheet("B")
    builder.append_row(idx_b, ["after-spill"])
    result = builder.finish([])

    spill = Path(result["result_path"])
    page_a = load_indexed_sheet_page(spill, sheet_name="A", sheet_index=None, offset=0, limit=10)
    page_b = load_indexed_sheet_page(spill, sheet_name="B", sheet_index=None, offset=0, limit=10)
    assert page_a["rows"] == [["before-spill"]]
    assert page_b["rows"] == [["after-spill"]]
    assert page_b["total"] == 1


def test_get_rows_rejects_path_outside_spill_dir(tmp_path: Path) -> None:
    foreign = tmp_path / "foreign.sqlite3"
    conn = sqlite3.connect(foreign)
    conn.close()
    with pytest.raises(ValueError, match="fuera del directorio"):
        spreadsheet_get_rows({"result_path": str(foreign), "offset": 0, "limit": 5})


def test_get_rows_validates_offset_and_limit(tmp_path: Path, monkeypatch) -> None:
    import tempfile

    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))
    cache = tmp_path / "antares-spreadsheet-results" / "cache.json"
    cache.parent.mkdir()
    cache.write_text(json.dumps({"sheets": [{"name": "S", "rows": [["x"]]}]}), encoding="utf-8")

    with pytest.raises(ValueError, match="offset"):
        spreadsheet_get_rows({"result_path": str(cache), "offset": "nan-ish", "limit": 5})
    with pytest.raises(ValueError, match="limit"):
        spreadsheet_get_rows({"result_path": str(cache), "offset": 0, "limit": "nan-ish"})

    from backend.handlers import spreadsheet as ss

    page = spreadsheet_get_rows(
        {"result_path": str(cache), "offset": 0, "limit": ss.MAX_GET_ROWS_LIMIT + 50_000},
    )
    assert page["limit"] == ss.MAX_GET_ROWS_LIMIT


def test_spill_dir_rejects_non_directory(tmp_path: Path, monkeypatch) -> None:
    import tempfile

    from backend.handlers import spreadsheet as ss

    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))
    (tmp_path / "antares-spreadsheet-results").write_text("ocupado", encoding="utf-8")
    with pytest.raises(RuntimeError, match="no es un directorio"):
        ss._spill_dir()


def test_load_sheet_cache_rejects_corrupt_json(tmp_path: Path) -> None:
    from backend.handlers import spreadsheet as ss

    cache_dir = tmp_path / "antares-spreadsheet-results"
    cache_dir.mkdir()
    cache = cache_dir / "cache.json"
    cache.write_text("{ not json", encoding="utf-8")
    with pytest.raises(json.JSONDecodeError):
        ss._load_sheet_cache(cache)

    cache.write_text(json.dumps({"rows": []}), encoding="utf-8")
    with pytest.raises(ValueError, match="corrupto"):
        ss._load_sheet_cache(cache)


def test_load_sheet_cache_rejects_oversized_cache(tmp_path: Path, monkeypatch) -> None:
    from backend.handlers import spreadsheet as ss

    monkeypatch.setattr(ss, "MAX_SPREADSHEET_BYTES", 10)
    cache_dir = tmp_path / "antares-spreadsheet-results"
    cache_dir.mkdir()
    cache = cache_dir / "big.json"
    cache.write_text(json.dumps({"sheets": [{"name": "S", "rows": []}]}), encoding="utf-8")
    with pytest.raises(ValueError, match="demasiado grande"):
        ss._load_sheet_cache(cache)
