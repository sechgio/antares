
from __future__ import annotations

from pathlib import Path

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


def test_preview_with_mapping(monkeypatch, tmp_path) -> None:
    files = [str(tmp_path / "IMG_0001.jpg"), str(tmp_path / "IMG_0002.jpg")]
    for f in files:
        Path(f).write_text("x")

    result = conversion.preview({
        "files": files,
        "patron": "",
        "mapping": {
            "IMG_0001.jpg": "fachada_norte",
            "IMG_0002.jpg": "fachada_sur",
        },
    })

    preview = {item["origen"]: item for item in result["preview"]}
    assert preview["IMG_0001.jpg"]["nuevo"] == "fachada_norte.jpg"
    assert preview["IMG_0002.jpg"]["nuevo"] == "fachada_sur.jpg"
    assert "truncated" not in result


def test_preview_truncates_over_max_files(tmp_path) -> None:
    n = conversion.MAX_PREVIEW_FILES + 1
    files = []
    mapping = {}
    for i in range(n):
        name = f"IMG_{i:04d}.jpg"
        path = tmp_path / name
        path.write_text("x")
        files.append(str(path))
        mapping[name] = f"out_{i:04d}"

    result = conversion.preview({
        "files": files,
        "patron": "",
        "mapping": mapping,
    })

    assert result["truncated"] is True
    assert result["total_files"] == n
    assert len(result["preview"]) == conversion.MAX_PREVIEW_FILES
    assert result["preview"][0]["origen"] == "IMG_0000.jpg"
    assert result["preview"][-1]["origen"] == f"IMG_{conversion.MAX_PREVIEW_FILES - 1:04d}.jpg"


def test_preview_reports_collisions(monkeypatch, tmp_path) -> None:
    files = [str(tmp_path / "A.jpg"), str(tmp_path / "B.jpg")]
    for f in files:
        Path(f).write_text("x")

    result = conversion.preview({
        "files": files,
        "patron": "",
        "mapping": {"A.jpg": "mismo", "B.jpg": "mismo"},
    })

    assert len(result["collisions"]) == 1
    assert result["collisions"][0]["output"] == "mismo.jpg"


def test_run_conversion_job_aborts_on_collision(monkeypatch, tmp_path) -> None:
    src = tmp_path / "in"
    dst = tmp_path / "out"
    src.mkdir()
    dst.mkdir()
    file_a = src / "A.jpg"
    file_b = src / "B.jpg"
    file_a.write_text("a")
    file_b.write_text("b")

    scheduler = _RecordingScheduler()
    monkeypatch.setattr(conversion, "get_scheduler", lambda: scheduler)
    monkeypatch.setattr(conversion, "_notify_complete", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("backend.core.history.save_run", lambda **_kwargs: None)

    job = Job(
        id="collision",
        job_type="conversion",
        params={
            "files": [str(file_a), str(file_b)],
            "destino": str(dst),
            "formato": "JPEG",
            "conversion_enabled": False,
            "usar_rename": True,
            "patron": "",
            "mapping": {"A.jpg": "mismo", "B.jpg": "mismo"},
        },
    )
    conversion._run_conversion_job(job)

    assert len(scheduler.submitted) == 0


def test_mapping_precedence_over_key_column(monkeypatch, tmp_path) -> None:
    files = [str(tmp_path / "IMG_0001.jpg")]
    Path(files[0]).write_text("x")

    monkeypatch.setattr(
        "backend.core.database.buscar_por_columna",
        lambda *_args, **_kwargs: {"IMG_0001": {"codigo": "IMG_0001", "nombre": "desde_bd"}},
    )

    result = conversion.preview({
        "files": files,
        "patron": "{nombre}{ext}",
        "key_column": "codigo",
        "mapping": {"IMG_0001.jpg": "desde_mapeo"},
    })

    assert result["preview"][0]["nuevo"] == "desde_mapeo.jpg"


def test_preview_resolves_sep_placeholder(monkeypatch, tmp_path) -> None:
    files = [str(tmp_path / "IMG_0001.jpg")]
    Path(files[0]).write_text("x")

    monkeypatch.setattr(
        "backend.core.database.buscar_por_columna",
        lambda *_args, **_kwargs: {
            "IMG_0001": {"sgio": "454654001", "nombre": "producto"},
        },
    )

    result = conversion.preview({
        "files": files,
        "patron": "{sgio}{sep}{nombre}{ext}",
        "word_separator": "-",
        "key_column": "sgio",
        "use_filename_seq": False,
        "secuencia": 1,
    })

    assert result["preview"][0]["nuevo"] == "454654001-producto.jpg"


def test_preview_sep_defaults_to_underscore(monkeypatch, tmp_path) -> None:
    files = [str(tmp_path / "1.jpg")]
    Path(files[0]).write_text("x")

    monkeypatch.setattr(
        "backend.core.database.buscar_por_columna",
        lambda *_args, **_kwargs: {"1": {"codigo": "1", "nombre": "foto"}},
    )

    result = conversion.preview({
        "files": files,
        "patron": "{codigo}{sep}{nombre}{ext}",
        "key_column": "codigo",
        "use_filename_seq": False,
        "secuencia": 1,
    })

    assert result["preview"][0]["nuevo"] == "1_foto.jpg"


def test_run_conversion_job_resolves_sep_placeholder(monkeypatch, tmp_path) -> None:
    src = tmp_path / "in"
    dst = tmp_path / "out"
    src.mkdir()
    dst.mkdir()
    source_file = src / "1.jpg"
    source_file.write_text("data")

    scheduler = _RecordingScheduler()
    copied: list[tuple[str, str]] = []

    monkeypatch.setattr(conversion, "get_scheduler", lambda: scheduler)
    monkeypatch.setattr(conversion, "es_video", lambda _path: False)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 10)
    monkeypatch.setattr(conversion, "copiar_archivo", lambda src_path, out_path, **_kwargs: copied.append((str(src_path), str(out_path))))
    monkeypatch.setattr(conversion, "_notify_complete", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("backend.core.history.save_run", lambda **_kwargs: None)
    monkeypatch.setattr(
        "backend.core.database.buscar_por_columna",
        lambda *_args, **_kwargs: {"1": {"sgio": "454654001", "nombre": "producto"}},
    )

    job = Job(
        id="sep-rename",
        job_type="conversion",
        params={
            "files": [str(source_file)],
            "destino": str(dst),
            "formato": "JPEG",
            "conversion_enabled": False,
            "usar_rename": True,
            "patron": "{sgio}{sep}{nombre}{ext}",
            "word_separator": "_",
            "key_column": "sgio",
            "use_filename_seq": False,
            "secuencia": 1,
        },
    )
    conversion._run_conversion_job(job)

    assert len(scheduler.submitted) == 1
    _src, out_path, _is_video = scheduler.submitted[0]
    assert out_path.name == "454654001_producto.jpg"
    assert len(copied) == 1
    assert Path(copied[0][1]).name == "454654001_producto.jpg"


def test_prepare_chunk_renames_windows_parenthesized_sequence(monkeypatch, tmp_path) -> None:
    source_file = tmp_path / "4210502 (3).jpg"
    source_file.write_text("data")

    monkeypatch.setattr(conversion, "es_video", lambda _path: False)
    monkeypatch.setattr("backend.core.renamer.get_field_names", lambda: ["nis", "sgio"])

    def buscar_por_nis(codigos, columna):
        assert columna == "nis"
        if "4210502" not in codigos:
            return {}
        return {"4210502": {"nis": "4210502", "sgio": "69841274"}}

    monkeypatch.setattr("backend.core.database.buscar_por_columna", buscar_por_nis)
    engine = conversion.RenamerEngine("{sgio}_{seq}{ext}", 1, sequence_mode="filename")
    tasks = conversion._prepare_chunk_tasks(
        [str(source_file)],
        destino=str(tmp_path / "out"),
        engine=engine,
        conversion_enabled=False,
        ext_dest=None,
        lookup_fn=lambda _codes: {},
        key_column="nis",
    )

    assert tasks[0][1].name == "69841274_3.jpg"


def test_prepare_chunk_unmapped_sanitizes_invalid_chars(monkeypatch, tmp_path) -> None:
    source_file = tmp_path / "bad<>name.jpg"

    monkeypatch.setattr(conversion, "es_video", lambda _path: False)
    from backend.core.mapping_index import MappingIndex

    engine = conversion.RenamerEngine("{renombre}{ext}", 1)
    tasks = conversion._prepare_chunk_tasks(
        [str(source_file)],
        destino=str(tmp_path / "out"),
        engine=engine,
        conversion_enabled=False,
        ext_dest=None,
        lookup_fn=lambda _codes: {},
        mapping_index=MappingIndex({"other.jpg": "ok"}),
    )

    assert tasks[0][1].name == "bad__name.jpg"


def test_run_conversion_job_with_mapping_rename_only(monkeypatch, tmp_path) -> None:
    src = tmp_path / "in"
    dst = tmp_path / "out"
    src.mkdir()
    dst.mkdir()
    source_file = src / "IMG_0001.jpg"
    source_file.write_text("data")

    scheduler = _RecordingScheduler()
    copied: list[tuple[str, str]] = []

    monkeypatch.setattr(conversion, "get_scheduler", lambda: scheduler)
    monkeypatch.setattr(conversion, "es_video", lambda _path: False)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 10)
    monkeypatch.setattr(conversion, "copiar_archivo", lambda src_path, out_path, **_kwargs: copied.append((str(src_path), str(out_path))))
    monkeypatch.setattr(conversion, "_notify_complete", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("backend.core.history.save_run", lambda **_kwargs: None)

    job = Job(
        id="mapping-rename",
        job_type="conversion",
        params={
            "files": [str(source_file)],
            "destino": str(dst),
            "formato": "JPEG",
            "conversion_enabled": False,
            "usar_rename": True,
            "patron": "",
            "mapping": {"IMG_0001.jpg": "fachada_norte"},
        },
    )
    conversion._run_conversion_job(job)

    assert len(scheduler.submitted) == 1
    _src, out_path, _is_video = scheduler.submitted[0]
    assert out_path.name == "fachada_norte.jpg"
    assert len(copied) == 1
    assert Path(copied[0][1]).name == "fachada_norte.jpg"


def test_run_conversion_job_with_mapping_path_and_columns(monkeypatch, tmp_path) -> None:
    src = tmp_path / "in"
    dst = tmp_path / "out"
    src.mkdir()
    dst.mkdir()
    source_file = src / "IMG_0001.jpg"
    source_file.write_text("data")

    excel = tmp_path / "map.xlsx"
    import pandas as pd
    df = pd.DataFrame(
        [("IMG_0001.jpg", "codigo_001", "fachada_norte")],
        columns=["Archivo", "Codigo", "NuevoNombre"],
    )
    df.to_excel(excel, index=False, engine="openpyxl")

    scheduler = _RecordingScheduler()
    copied: list[tuple[str, str]] = []

    monkeypatch.setattr(conversion, "get_scheduler", lambda: scheduler)
    monkeypatch.setattr(conversion, "es_video", lambda _path: False)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 10)
    monkeypatch.setattr(conversion, "copiar_archivo", lambda src_path, out_path, **_kwargs: copied.append((str(src_path), str(out_path))))
    monkeypatch.setattr(conversion, "_notify_complete", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("backend.core.history.save_run", lambda **_kwargs: None)

    job = Job(
        id="mapping-path-columns",
        job_type="conversion",
        params={
            "files": [str(source_file)],
            "destino": str(dst),
            "formato": "JPEG",
            "conversion_enabled": False,
            "usar_rename": True,
            "patron": "",
            "mapping_path": str(excel),
            "id_column": "archivo",
            "rename_column": "nuevonombre",
        },
    )
    conversion._run_conversion_job(job)

    assert len(scheduler.submitted) == 1
    _src, out_path, _is_video = scheduler.submitted[0]
    assert out_path.name == "fachada_norte.jpg"


def test_preview_with_mapping_path_and_columns(tmp_path) -> None:
    file_path = tmp_path / "IMG_0001.jpg"
    file_path.write_text("x")

    excel = tmp_path / "map.xlsx"
    import pandas as pd
    df = pd.DataFrame(
        [("IMG_0001.jpg", "codigo_001", "fachada_norte")],
        columns=["Archivo", "Codigo", "NuevoNombre"],
    )
    df.to_excel(excel, index=False, engine="openpyxl")

    result = conversion.preview({
        "files": [str(file_path)],
        "patron": "",
        "mapping_path": str(excel),
        "id_column": "archivo",
        "rename_column": "nuevonombre",
    })

    assert len(result["preview"]) == 1
    assert result["preview"][0]["origen"] == "IMG_0001.jpg"
    assert result["preview"][0]["nuevo"] == "fachada_norte.jpg"
    assert result["preview"][0]["en_bd"] is True


def test_preview_mapping_path_auto_detects_columns(tmp_path) -> None:
    file_path = tmp_path / "IMG_0001.jpg"
    file_path.write_text("x")

    excel = tmp_path / "map.xlsx"
    import pandas as pd
    df = pd.DataFrame(
        [("IMG_0001.jpg", "fachada_norte")],
        columns=["ID", "RENOMBRE"],
    )
    df.to_excel(excel, index=False, engine="openpyxl")

    result = conversion.preview({
        "files": [str(file_path)],
        "patron": "",
        "mapping_path": str(excel),
    })

    assert result["preview"][0]["nuevo"] == "fachada_norte.jpg"
    assert result["preview"][0]["en_bd"] is True


def test_preview_inline_mapping_takes_precedence_over_mapping_path(tmp_path) -> None:
    file_path = tmp_path / "IMG_0001.jpg"
    file_path.write_text("x")

    excel = tmp_path / "map.xlsx"
    import pandas as pd
    df = pd.DataFrame(
        [("IMG_0001.jpg", "desde_excel")],
        columns=["ID", "RENOMBRE"],
    )
    df.to_excel(excel, index=False, engine="openpyxl")

    result = conversion.preview({
        "files": [str(file_path)],
        "patron": "",
        "mapping": {"IMG_0001.jpg": "desde_inline"},
        "mapping_path": str(excel),
    })

    assert result["preview"][0]["nuevo"] == "desde_inline.jpg"
