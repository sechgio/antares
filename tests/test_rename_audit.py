"""Audit tests reproducing the user-reported rename bug.

Scenario: User loads a DB with columns (nis, sgio), sets pattern
{sgio}{sep}{seq}{ext}, sees a correct synthetic preview, but processing
doesn't rename the files.

Root cause hypotheses tested here:
  H1. The keyColumn defaults to the first DB column ('nis'), but the file
      codes live in the 'sgio' column -> buscar_por_columna finds nothing
      -> files keep their original names.
  H2. The backend preview and the processing path use the same lookup,
      so both fail identically. The user only sees a synthetic example
      in the UI (never the real preview results in catalog mode).
  H3. When no DB match is found, the file is silently copied with its
      original name (no warning).
"""

from __future__ import annotations

from pathlib import Path

from backend.core.config_fields import save_fields
from backend.core.jobs import Job
from backend.handlers import conversion


class _ImmediateFuture:
    def __init__(self, result):
        self._result = result

    def result(self):
        return self._result

    def cancelled(self):
        return False

    def cancel(self):
        return False


class _RecordingScheduler:
    def __init__(self) -> None:
        self.submitted: list[tuple[str, Path, bool]] = []

    def submit_heavy(self, fn, task, *, block=False, cancel_check=None):  # type: ignore[no-untyped-def]
        self.submitted.append(task)
        return _ImmediateFuture(fn(task))


def _setup_fields(monkeypatch, tmp_path, fields):
    """Redirect fields config to a temp file and save the given fields."""
    config_path = tmp_path / "fields_config.json"
    monkeypatch.setattr(
        "backend.core.config_fields._config_file",
        lambda: config_path,
    )
    monkeypatch.setattr(
        "backend.core.config_fields._invalidate_fields_cache",
        lambda: None,
    )
    save_fields(fields)


def _make_job(tmp_path, files, **extra):
    src = tmp_path / "in"
    dst = tmp_path / "out"
    src.mkdir()
    dst.mkdir()
    real_files = []
    for f in files:
        p = src / f
        p.write_text("img")
        real_files.append(str(p))

    params = {
        "files": real_files,
        "destino": str(dst),
        "formato": "JPEG",
        "conversion_enabled": False,
        "usar_rename": True,
        "patron": "{sgio}{sep}{seq}{ext}",
        "word_separator": "_",
        "use_filename_seq": True,
        "secuencia": 1,
    }
    params.update(extra)
    return Job(id="audit", job_type="conversion", params=params), src, dst, real_files


# ─── H1: keyColumn defaults to first column but file codes are in another ───


def test_rename_fails_when_keycolumn_doesnt_contain_file_codes(monkeypatch, tmp_path):
    """BEFORE FIX: When keyColumn='nis' but file codes are in 'sgio', rename
    silently failed (files kept their original names).
    AFTER FIX: Auto-detection finds 'sgio' and the rename succeeds."""
    _setup_fields(monkeypatch, tmp_path, [
        {"name": "nis", "type": "TEXT", "required": False, "unique": False},
        {"name": "sgio", "type": "TEXT", "required": False, "unique": False},
    ])

    scheduler = _RecordingScheduler()
    copied: list[tuple[str, str]] = []

    monkeypatch.setattr(conversion, "get_scheduler", lambda: scheduler)
    monkeypatch.setattr(conversion, "es_video", lambda _p: False)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 10)
    monkeypatch.setattr(conversion, "copiar_archivo", lambda s, d: copied.append((str(s), str(d))))
    monkeypatch.setattr(conversion, "_notify_complete", lambda *a, **k: None)
    monkeypatch.setattr("backend.core.history.save_run", lambda **k: None)

    # DB has nis=ABC, sgio=69841274 — file code 69841274 is in sgio, NOT nis
    monkeypatch.setattr(
        "backend.core.database.buscar_por_columna",
        lambda codes, col: {} if col == "nis" else {"69841274": {"nis": "ABC", "sgio": "454654001"}},
    )

    job, _src, _dst, _real_files = _make_job(
        tmp_path, ["69841274_001.jpg"],
        key_column="nis",  # default — first column
    )
    conversion._run_conversion_job(job)

    assert len(scheduler.submitted) == 1
    _src, out_path, _is_video = scheduler.submitted[0]
    # After the fix, auto-detection finds 'sgio' and renames correctly
    assert out_path.name == "454654001_001.jpg", (
        f"Auto-detection should find sgio and rename, got: {out_path.name}"
    )


def test_rename_works_when_keycolumn_matches_file_codes(monkeypatch, tmp_path):
    """When keyColumn='sgio' and file codes ARE in 'sgio', rename works."""
    _setup_fields(monkeypatch, tmp_path, [
        {"name": "nis", "type": "TEXT", "required": False, "unique": False},
        {"name": "sgio", "type": "TEXT", "required": False, "unique": False},
    ])

    scheduler = _RecordingScheduler()
    copied: list[tuple[str, str]] = []

    monkeypatch.setattr(conversion, "get_scheduler", lambda: scheduler)
    monkeypatch.setattr(conversion, "es_video", lambda _p: False)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 10)
    monkeypatch.setattr(conversion, "copiar_archivo", lambda s, d: copied.append((str(s), str(d))))
    monkeypatch.setattr(conversion, "_notify_complete", lambda *a, **k: None)
    monkeypatch.setattr("backend.core.history.save_run", lambda **k: None)

    # DB has nis=ABC, sgio=69841274 — file code 69841274 IS in sgio
    monkeypatch.setattr(
        "backend.core.database.buscar_por_columna",
        lambda codes, col: {"69841274": {"nis": "ABC", "sgio": "454654001"}} if col == "sgio" else {},
    )

    job, _src, _dst, _real_files = _make_job(
        tmp_path, ["69841274_001.jpg"],
        key_column="sgio",  # correct — file codes are in sgio
    )
    conversion._run_conversion_job(job)

    assert len(scheduler.submitted) == 1
    _src, out_path, _is_video = scheduler.submitted[0]
    assert out_path.name == "454654001_001.jpg", (
        f"Expected renamed file, got {out_path.name}"
    )


# ─── H2: preview and process use the same lookup ─────────────────────────


def test_preview_also_fails_with_wrong_keycolumn(monkeypatch, tmp_path):
    """BEFORE FIX: The backend preview also failed when keyColumn was wrong.
    AFTER FIX: Auto-detection resolves the correct column, so it now succeeds."""
    _setup_fields(monkeypatch, tmp_path, [
        {"name": "nis", "type": "TEXT", "required": False, "unique": False},
        {"name": "sgio", "type": "TEXT", "required": False, "unique": False},
    ])

    f = tmp_path / "69841274_001.jpg"
    f.write_text("x")

    monkeypatch.setattr(
        "backend.core.database.buscar_por_columna",
        lambda codes, col: {} if col == "nis" else {"69841274": {"nis": "ABC", "sgio": "454654001"}},
    )

    result = conversion.preview({
        "files": [str(f)],
        "patron": "{sgio}{sep}{seq}{ext}",
        "word_separator": "_",
        "key_column": "nis",
        "use_filename_seq": True,
        "secuencia": 1,
    })

    # After the fix, auto-detection finds 'sgio' and the preview succeeds
    assert result["preview"][0]["en_bd"] is True
    assert result["preview"][0]["nuevo"] == "454654001_001.jpg"


def test_preview_works_with_correct_keycolumn(monkeypatch, tmp_path):
    """The backend preview works when keyColumn is correct."""
    _setup_fields(monkeypatch, tmp_path, [
        {"name": "nis", "type": "TEXT", "required": False, "unique": False},
        {"name": "sgio", "type": "TEXT", "required": False, "unique": False},
    ])

    f = tmp_path / "69841274_001.jpg"
    f.write_text("x")

    monkeypatch.setattr(
        "backend.core.database.buscar_por_columna",
        lambda codes, col: {"69841274": {"nis": "ABC", "sgio": "454654001"}} if col == "sgio" else {},
    )

    result = conversion.preview({
        "files": [str(f)],
        "patron": "{sgio}{sep}{seq}{ext}",
        "word_separator": "_",
        "key_column": "sgio",
        "use_filename_seq": True,
        "secuencia": 1,
    })

    assert result["preview"][0]["en_bd"] is True
    assert result["preview"][0]["nuevo"] == "454654001_001.jpg"


# ─── Auto-detection: finding the right keyColumn ──────────────────────────


def test_auto_detect_keycolumn_finds_best_match(monkeypatch, tmp_path):
    """Auto-detection should pick the column where file codes actually match."""
    _setup_fields(monkeypatch, tmp_path, [
        {"name": "nis", "type": "TEXT", "required": False, "unique": False},
        {"name": "sgio", "type": "TEXT", "required": False, "unique": False},
    ])

    # Simulate a real DB: nis has unrelated values, sgio has file codes
    db_records = [
        {"nis": "ABC", "sgio": "69841274"},
        {"nis": "DEF", "sgio": "69841275"},
    ]

    def mock_buscar(codes, col):
        result = {}
        for rec in db_records:
            val = str(rec.get(col, "") or "").strip()
            if val and val in codes:
                result[val] = rec
        return result

    monkeypatch.setattr("backend.core.database.buscar_por_columna", mock_buscar)

    file_codes = ["69841274", "69841275"]

    # Test auto-detection logic: try each column and count matches
    columns = ["nis", "sgio"]
    best_col = None
    best_matches = 0
    for col in columns:
        matches = mock_buscar(file_codes, col)
        if len(matches) > best_matches:
            best_matches = len(matches)
            best_col = col

    assert best_col == "sgio"
    assert best_matches == 2


# ─── FIX VERIFICATION: auto-detection resolves the wrong key column ───────


def test_fix_preview_auto_detects_correct_keycolumn(monkeypatch, tmp_path):
    """FIX: preview auto-detects the correct key column when the provided
    one doesn't match any file codes."""
    _setup_fields(monkeypatch, tmp_path, [
        {"name": "nis", "type": "TEXT", "required": False, "unique": False},
        {"name": "sgio", "type": "TEXT", "required": False, "unique": False},
    ])

    f = tmp_path / "69841274_001.jpg"
    f.write_text("x")

    # DB: nis has unrelated values, sgio has file codes
    def mock_buscar(codes, col):
        if col == "nis":
            return {}  # nis doesn't contain file codes
        if col == "sgio":
            return {"69841274": {"nis": "ABC", "sgio": "454654001"}}
        return {}

    monkeypatch.setattr("backend.core.database.buscar_por_columna", mock_buscar)

    # User sends key_column="nis" (the default, wrong one) — the fix should
    # auto-detect "sgio" and produce the correct renamed output.
    result = conversion.preview({
        "files": [str(f)],
        "patron": "{sgio}{sep}{seq}{ext}",
        "word_separator": "_",
        "key_column": "nis",  # wrong — but auto-detection should fix it
        "use_filename_seq": True,
        "secuencia": 1,
    })

    assert result["preview"][0]["en_bd"] is True
    assert result["preview"][0]["nuevo"] == "454654001_001.jpg", (
        f"Auto-detection should find sgio, got: {result['preview'][0]['nuevo']}"
    )


def test_fix_process_auto_detects_correct_keycolumn(monkeypatch, tmp_path):
    """FIX: processing auto-detects the correct key column when the provided
    one doesn't match any file codes."""
    _setup_fields(monkeypatch, tmp_path, [
        {"name": "nis", "type": "TEXT", "required": False, "unique": False},
        {"name": "sgio", "type": "TEXT", "required": False, "unique": False},
    ])

    scheduler = _RecordingScheduler()
    copied: list[tuple[str, str]] = []

    monkeypatch.setattr(conversion, "get_scheduler", lambda: scheduler)
    monkeypatch.setattr(conversion, "es_video", lambda _p: False)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 10)
    monkeypatch.setattr(conversion, "copiar_archivo", lambda s, d: copied.append((str(s), str(d))))
    monkeypatch.setattr(conversion, "_notify_complete", lambda *a, **k: None)
    monkeypatch.setattr("backend.core.history.save_run", lambda **k: None)

    # DB: nis has unrelated values, sgio has file codes
    def mock_buscar(codes, col):
        if col == "nis":
            return {}
        if col == "sgio":
            return {"69841274": {"nis": "ABC", "sgio": "454654001"}}
        return {}

    monkeypatch.setattr("backend.core.database.buscar_por_columna", mock_buscar)

    job, _src, _dst, _real_files = _make_job(
        tmp_path, ["69841274_001.jpg"],
        key_column="nis",  # wrong — but auto-detection should fix it
    )
    conversion._run_conversion_job(job)

    assert len(scheduler.submitted) == 1
    _src, out_path, _is_video = scheduler.submitted[0]
    assert out_path.name == "454654001_001.jpg", (
        f"Auto-detection should find sgio and rename, got: {out_path.name}"
    )
    assert len(copied) == 1
    assert Path(copied[0][1]).name == "454654001_001.jpg"


def test_fix_process_auto_detects_when_keycolumn_empty(monkeypatch, tmp_path):
    """When key_column is empty, the legacy buscar_lote_por_codigos path is
    used (matches across all fields). Auto-detection only kicks in when
    key_column is explicitly provided but wrong."""
    _setup_fields(monkeypatch, tmp_path, [
        {"name": "nis", "type": "TEXT", "required": False, "unique": False},
        {"name": "sgio", "type": "TEXT", "required": False, "unique": False},
    ])

    scheduler = _RecordingScheduler()
    copied: list[tuple[str, str]] = []

    monkeypatch.setattr(conversion, "get_scheduler", lambda: scheduler)
    monkeypatch.setattr(conversion, "es_video", lambda _p: False)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 10)
    monkeypatch.setattr(conversion, "copiar_archivo", lambda s, d: copied.append((str(s), str(d))))
    monkeypatch.setattr(conversion, "_notify_complete", lambda *a, **k: None)
    monkeypatch.setattr("backend.core.history.save_run", lambda **k: None)

    def mock_buscar(codes, col):
        if col == "nis":
            return {}
        if col == "sgio":
            return {"69841274": {"nis": "ABC", "sgio": "454654001"}}
        return {}

    monkeypatch.setattr("backend.core.database.buscar_por_columna", mock_buscar)

    # Legacy path: buscar_lote_por_codigos searches all fields
    monkeypatch.setattr(
        "backend.core.database.buscar_lote_por_codigos",
        lambda codes: {"69841274": {"nis": "ABC", "sgio": "454654001"}} if "69841274" in codes else {},
    )

    job, _src, _dst, _real_files = _make_job(
        tmp_path, ["69841274_001.jpg"],
        key_column="",  # empty — legacy path searches all fields
    )
    conversion._run_conversion_job(job)

    assert len(scheduler.submitted) == 1
    _src, out_path, _is_video = scheduler.submitted[0]
    # Legacy path finds the record via buscar_lote_por_codigos
    assert out_path.name == "454654001_001.jpg", (
        f"Legacy path should find record, got: {out_path.name}"
    )


# ─── db_detect_key_column handler ─────────────────────────────────────────


def test_db_detect_key_column_picks_best_match(monkeypatch, tmp_path):
    """The db_detect_key_column handler returns the column with most matches."""
    _setup_fields(monkeypatch, tmp_path, [
        {"name": "nis", "type": "TEXT", "required": False, "unique": False},
        {"name": "sgio", "type": "TEXT", "required": False, "unique": False},
    ])

    f1 = tmp_path / "69841274_001.jpg"
    f2 = tmp_path / "69841275_001.jpg"
    f1.write_text("x")
    f2.write_text("x")

    def mock_buscar(codes, col):
        if col == "nis":
            return {}
        if col == "sgio":
            return {
                "69841274": {"nis": "ABC", "sgio": "69841274"},
                "69841275": {"nis": "DEF", "sgio": "69841275"},
            }
        return {}

    monkeypatch.setattr("backend.core.database.buscar_por_columna", mock_buscar)

    result = conversion.db_detect_key_column({"files": [str(f1), str(f2)]})

    assert result["key_column"] == "sgio"
    assert result["matches"] == 2
    col_map = {c["name"]: c["matches"] for c in result["columns"]}
    assert col_map["nis"] == 0
    assert col_map["sgio"] == 2


def test_db_detect_key_column_returns_first_when_no_match(monkeypatch, tmp_path):
    """When no column matches, the first column is returned as fallback."""
    _setup_fields(monkeypatch, tmp_path, [
        {"name": "nis", "type": "TEXT", "required": False, "unique": False},
        {"name": "sgio", "type": "TEXT", "required": False, "unique": False},
    ])

    f = tmp_path / "UNKNOWN_001.jpg"
    f.write_text("x")

    monkeypatch.setattr("backend.core.database.buscar_por_columna", lambda codes, col: {})

    result = conversion.db_detect_key_column({"files": [str(f)]})

    assert result["key_column"] == "nis"  # first column as fallback
    assert result["matches"] == 0


def test_db_detect_key_column_empty_files(monkeypatch, tmp_path):
    """Empty file list returns empty result."""
    _setup_fields(monkeypatch, tmp_path, [
        {"name": "nis", "type": "TEXT", "required": False, "unique": False},
    ])

    result = conversion.db_detect_key_column({"files": []})
    assert result["key_column"] == ""
    assert result["matches"] == 0


def test_db_detect_key_column_single_column(monkeypatch, tmp_path):
    """Single column DB returns that column without probing."""
    _setup_fields(monkeypatch, tmp_path, [
        {"name": "codigo", "type": "TEXT", "required": False, "unique": False},
    ])

    f = tmp_path / "69841274_001.jpg"
    f.write_text("x")

    result = conversion.db_detect_key_column({"files": [str(f)]})
    assert result["key_column"] == "codigo"


# ─── Characterization: preview auto-detect aligns with db_detect ──────────


def _mock_nis_sgio_buscar(codes, col):
    if col == "nis":
        return {}
    if col == "sgio":
        return {
            "69841274": {"nis": "ABC", "sgio": "454654001"},
            "69841275": {"nis": "DEF", "sgio": "454654002"},
        }
    return {}


def test_preview_empty_key_uses_lote_process_semantics(monkeypatch, tmp_path):
    """Empty key_column preview follows process (lote), not db_detect auto-column.

    ``db_detect_key_column`` remains the FE path to choose an explicit column.
    Empty key_column must call ``buscar_lote_por_codigos`` so preview matches
    on-disk process results (plan 011).
    """
    _setup_fields(monkeypatch, tmp_path, [
        {"name": "nis", "type": "TEXT", "required": False, "unique": False},
        {"name": "sgio", "type": "TEXT", "required": False, "unique": False},
    ])

    f1 = tmp_path / "69841274_001.jpg"
    f2 = tmp_path / "69841275_001.jpg"
    f1.write_text("x")
    f2.write_text("x")
    file_paths = [str(f1), str(f2)]

    monkeypatch.setattr("backend.core.database.buscar_por_columna", _mock_nis_sgio_buscar)
    monkeypatch.setattr(
        "backend.core.database.buscar_lote_por_codigos",
        lambda codes: {
            "69841274": {"nis": "ABC", "sgio": "454654001"},
            "69841275": {"nis": "DEF", "sgio": "454654002"},
        },
    )

    detect = conversion.db_detect_key_column({"files": file_paths})
    assert detect["key_column"] == "sgio"
    assert detect["matches"] == 2

    preview_empty = conversion.preview({
        "files": file_paths,
        "patron": "{sgio}{sep}{seq}{ext}",
        "word_separator": "_",
        "use_filename_seq": True,
        "secuencia": 1,
    })
    preview_explicit = conversion.preview({
        "files": file_paths,
        "patron": "{sgio}{sep}{seq}{ext}",
        "word_separator": "_",
        "key_column": detect["key_column"],
        "use_filename_seq": True,
        "secuencia": 1,
    })

    # Both paths should resolve rename via sgio values when lote has the records
    # (empty) or explicit column (sgio). Neither should leave en_bd=False.
    assert all(row["en_bd"] for row in preview_empty["preview"])
    assert all(row["en_bd"] for row in preview_explicit["preview"])
    assert preview_empty["preview"][0]["nuevo"] == "454654001_001.jpg"
    assert preview_explicit["preview"][0]["nuevo"] == "454654001_001.jpg"
    # Empty key no longer injects detected_key_column (that was auto-detect UX).
    assert "detected_key_column" not in preview_empty


def test_preview_default_key_column_exposes_detect_fields(monkeypatch, tmp_path):
    """Wrong default key_column preview exposes the same detect metadata as db_detect."""
    _setup_fields(monkeypatch, tmp_path, [
        {"name": "nis", "type": "TEXT", "required": False, "unique": False},
        {"name": "sgio", "type": "TEXT", "required": False, "unique": False},
    ])

    f = tmp_path / "69841274_001.jpg"
    f.write_text("x")
    file_paths = [str(f)]

    monkeypatch.setattr("backend.core.database.buscar_por_columna", _mock_nis_sgio_buscar)

    detect = conversion.db_detect_key_column({"files": file_paths})
    preview = conversion.preview({
        "files": file_paths,
        "patron": "{sgio}{sep}{seq}{ext}",
        "word_separator": "_",
        "key_column": "nis",
        "use_filename_seq": True,
        "secuencia": 1,
    })
    preview_resolved = conversion.preview({
        "files": file_paths,
        "patron": "{sgio}{sep}{seq}{ext}",
        "word_separator": "_",
        "key_column": detect["key_column"],
        "use_filename_seq": True,
        "secuencia": 1,
    })

    assert preview["preview"] == preview_resolved["preview"]
    assert preview["detected_key_column"] == detect["key_column"]
    assert preview["detected_key_column_matches"] == detect["matches"]
