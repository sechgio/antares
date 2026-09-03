
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


def test_rename_fails_when_keycolumn_doesnt_contain_file_codes(monkeypatch, tmp_path):
    _setup_fields(monkeypatch, tmp_path, [
        {"name": "nis", "type": "TEXT", "required": False, "unique": False},
        {"name": "sgio", "type": "TEXT", "required": False, "unique": False},
    ])

    scheduler = _RecordingScheduler()
    copied: list[tuple[str, str]] = []

    monkeypatch.setattr(conversion, "get_scheduler", lambda: scheduler)
    monkeypatch.setattr(conversion, "es_video", lambda _p: False)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 10)
    monkeypatch.setattr(conversion, "copiar_archivo", lambda s, d, **_kwargs: copied.append((str(s), str(d))))
    monkeypatch.setattr(conversion, "_notify_complete", lambda *a, **k: None)
    monkeypatch.setattr("backend.core.history.save_run", lambda **k: None)

    monkeypatch.setattr(
        "backend.core.database.buscar_por_columna",
        lambda codes, col: {} if col == "nis" else {"69841274": {"nis": "ABC", "sgio": "454654001"}},
    )

    job, _src, _dst, _real_files = _make_job(
        tmp_path, ["69841274_001.jpg"],
        key_column="nis",
    )
    conversion._run_conversion_job(job)

    assert len(scheduler.submitted) == 1
    _src, out_path, _is_video = scheduler.submitted[0]
    assert out_path.name == "454654001_001.jpg", (
        f"Auto-detection should find sgio and rename, got: {out_path.name}"
    )


def test_rename_works_when_keycolumn_matches_file_codes(monkeypatch, tmp_path):
    _setup_fields(monkeypatch, tmp_path, [
        {"name": "nis", "type": "TEXT", "required": False, "unique": False},
        {"name": "sgio", "type": "TEXT", "required": False, "unique": False},
    ])

    scheduler = _RecordingScheduler()
    copied: list[tuple[str, str]] = []

    monkeypatch.setattr(conversion, "get_scheduler", lambda: scheduler)
    monkeypatch.setattr(conversion, "es_video", lambda _p: False)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 10)
    monkeypatch.setattr(conversion, "copiar_archivo", lambda s, d, **_kwargs: copied.append((str(s), str(d))))
    monkeypatch.setattr(conversion, "_notify_complete", lambda *a, **k: None)
    monkeypatch.setattr("backend.core.history.save_run", lambda **k: None)

    monkeypatch.setattr(
        "backend.core.database.buscar_por_columna",
        lambda codes, col: {"69841274": {"nis": "ABC", "sgio": "454654001"}} if col == "sgio" else {},
    )

    job, _src, _dst, _real_files = _make_job(
        tmp_path, ["69841274_001.jpg"],
        key_column="sgio",
    )
    conversion._run_conversion_job(job)

    assert len(scheduler.submitted) == 1
    _src, out_path, _is_video = scheduler.submitted[0]
    assert out_path.name == "454654001_001.jpg", (
        f"Expected renamed file, got {out_path.name}"
    )


def test_preview_also_fails_with_wrong_keycolumn(monkeypatch, tmp_path):
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

    assert result["preview"][0]["en_bd"] is True
    assert result["preview"][0]["nuevo"] == "454654001_001.jpg"


def test_preview_works_with_correct_keycolumn(monkeypatch, tmp_path):
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


def test_auto_detect_keycolumn_finds_best_match(monkeypatch, tmp_path):
    _setup_fields(monkeypatch, tmp_path, [
        {"name": "nis", "type": "TEXT", "required": False, "unique": False},
        {"name": "sgio", "type": "TEXT", "required": False, "unique": False},
    ])

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


def test_fix_preview_auto_detects_correct_keycolumn(monkeypatch, tmp_path):
    _setup_fields(monkeypatch, tmp_path, [
        {"name": "nis", "type": "TEXT", "required": False, "unique": False},
        {"name": "sgio", "type": "TEXT", "required": False, "unique": False},
    ])

    f = tmp_path / "69841274_001.jpg"
    f.write_text("x")

    def mock_buscar(codes, col):
        if col == "nis":
            return {}
        if col == "sgio":
            return {"69841274": {"nis": "ABC", "sgio": "454654001"}}
        return {}

    monkeypatch.setattr("backend.core.database.buscar_por_columna", mock_buscar)

    result = conversion.preview({
        "files": [str(f)],
        "patron": "{sgio}{sep}{seq}{ext}",
        "word_separator": "_",
        "key_column": "nis",
        "use_filename_seq": True,
        "secuencia": 1,
    })

    assert result["preview"][0]["en_bd"] is True
    assert result["preview"][0]["nuevo"] == "454654001_001.jpg", (
        f"Auto-detection should find sgio, got: {result['preview'][0]['nuevo']}"
    )


def test_fix_process_auto_detects_correct_keycolumn(monkeypatch, tmp_path):
    _setup_fields(monkeypatch, tmp_path, [
        {"name": "nis", "type": "TEXT", "required": False, "unique": False},
        {"name": "sgio", "type": "TEXT", "required": False, "unique": False},
    ])

    scheduler = _RecordingScheduler()
    copied: list[tuple[str, str]] = []

    monkeypatch.setattr(conversion, "get_scheduler", lambda: scheduler)
    monkeypatch.setattr(conversion, "es_video", lambda _p: False)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 10)
    monkeypatch.setattr(conversion, "copiar_archivo", lambda s, d, **_kwargs: copied.append((str(s), str(d))))
    monkeypatch.setattr(conversion, "_notify_complete", lambda *a, **k: None)
    monkeypatch.setattr("backend.core.history.save_run", lambda **k: None)

    def mock_buscar(codes, col):
        if col == "nis":
            return {}
        if col == "sgio":
            return {"69841274": {"nis": "ABC", "sgio": "454654001"}}
        return {}

    monkeypatch.setattr("backend.core.database.buscar_por_columna", mock_buscar)

    job, _src, _dst, _real_files = _make_job(
        tmp_path, ["69841274_001.jpg"],
        key_column="nis",
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
    _setup_fields(monkeypatch, tmp_path, [
        {"name": "nis", "type": "TEXT", "required": False, "unique": False},
        {"name": "sgio", "type": "TEXT", "required": False, "unique": False},
    ])

    scheduler = _RecordingScheduler()
    copied: list[tuple[str, str]] = []

    monkeypatch.setattr(conversion, "get_scheduler", lambda: scheduler)
    monkeypatch.setattr(conversion, "es_video", lambda _p: False)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 10)
    monkeypatch.setattr(conversion, "copiar_archivo", lambda s, d, **_kwargs: copied.append((str(s), str(d))))
    monkeypatch.setattr(conversion, "_notify_complete", lambda *a, **k: None)
    monkeypatch.setattr("backend.core.history.save_run", lambda **k: None)

    def mock_buscar(codes, col):
        if col == "nis":
            return {}
        if col == "sgio":
            return {"69841274": {"nis": "ABC", "sgio": "454654001"}}
        return {}

    monkeypatch.setattr("backend.core.database.buscar_por_columna", mock_buscar)

    monkeypatch.setattr(
        "backend.core.database.buscar_lote_por_codigos",
        lambda codes: {"69841274": {"nis": "ABC", "sgio": "454654001"}} if "69841274" in codes else {},
    )

    job, _src, _dst, _real_files = _make_job(
        tmp_path, ["69841274_001.jpg"],
        key_column="",
    )
    conversion._run_conversion_job(job)

    assert len(scheduler.submitted) == 1
    _src, out_path, _is_video = scheduler.submitted[0]
    assert out_path.name == "454654001_001.jpg", (
        f"Legacy path should find record, got: {out_path.name}"
    )


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
        "key_column": "sgio",
        "use_filename_seq": True,
        "secuencia": 1,
    })

    assert all(row["en_bd"] for row in preview_empty["preview"])
    assert all(row["en_bd"] for row in preview_explicit["preview"])
    assert preview_empty["preview"][0]["nuevo"] == "454654001_001.jpg"
    assert preview_explicit["preview"][0]["nuevo"] == "454654001_001.jpg"
    assert "detected_key_column" not in preview_empty


def test_preview_default_key_column_exposes_detect_fields(monkeypatch, tmp_path):
    _setup_fields(monkeypatch, tmp_path, [
        {"name": "nis", "type": "TEXT", "required": False, "unique": False},
        {"name": "sgio", "type": "TEXT", "required": False, "unique": False},
    ])

    f = tmp_path / "69841274_001.jpg"
    f.write_text("x")
    file_paths = [str(f)]

    monkeypatch.setattr("backend.core.database.buscar_por_columna", _mock_nis_sgio_buscar)

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
        "key_column": "sgio",
        "use_filename_seq": True,
        "secuencia": 1,
    })

    assert preview["preview"] == preview_resolved["preview"]
    assert preview["detected_key_column"] == "sgio"
    assert preview["detected_key_column_matches"] == 2
