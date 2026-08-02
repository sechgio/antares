"""Validación de use_column_rename: lookup roto vs fix por índice.

Cada test documenta un escenario del análisis datos=None vs codigo in codigos_list.
Los tests ``broken_*`` reproducen el comportamiento viejo sin tocar producción.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from backend.core.jobs import Job
from backend.core.renamer import RenamerEngine
from backend.handlers import conversion
from backend.utils.validators import parse_filename_parts


def _slice_db_rows(rows: list[dict[str, Any]], limit: int | None = None, offset: int = 0) -> list[dict[str, Any]]:
    if limit is None:
        return rows[offset:]
    return rows[offset : offset + limit]


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

    def submit_heavy(self, fn, task, *, block=False, cancel_check=None):
        self.submitted.append(task)
        return _ImmediateFuture(fn(task))


def _broken_lookup(codigos_list: list[str], db_rows: list[dict[str, Any]]):
    """Réplica exacta del lookup roto eliminado de conversion.preview."""
    db_cache = {str(i): rec for i, rec in enumerate(db_rows)}

    def lookup(codigo: str) -> dict[str, Any] | None:
        idx = str(codigos_list.index(codigo)) if codigo in codigos_list else None
        return db_cache.get(idx) if idx else None

    return lookup


def _preview_via_broken_lookup(
    files: list[str],
    db_rows: list[dict[str, Any]],
    *,
    codigos_manuales: dict[str, str] | None = None,
    sequence_mode: str = "global",
    autofill_codigos_manuales: bool = True,
) -> list[tuple[str, bool]]:
    """Simula el preview viejo (preview_lote + lookup por codigo)."""
    codigos_manuales = {} if codigos_manuales is None else dict(codigos_manuales)
    codigos_list: list[str] = []
    file_seqs: dict[str, str] = {}
    sequence_groups: dict[str, str] = {}

    for index, f in enumerate(files):
        name = Path(f).name
        code, seq = parse_filename_parts(name)
        if autofill_codigos_manuales:
            codigos_manuales.setdefault(name, code)
        codigos_list.append(code)
        file_seqs[name] = seq
        datos = db_rows[index] if index < len(db_rows) else None
        if datos and name in codigos_manuales:
            sequence_groups[name] = conversion._record_group_key(datos, "", codigos_manuales[name])

    engine = RenamerEngine(
        "{sgio}_{seq}{ext}",
        1,
        sequence_mode=sequence_mode,  # type: ignore[arg-type]
    )
    lookup = _broken_lookup(codigos_list, db_rows)
    rows = engine.preview_lote(
        files,
        lookup_fn=lookup,
        codigos_manuales=codigos_manuales,
        file_seqs=file_seqs,
        sequence_groups=sequence_groups,
    )
    return [(nuevo, en_bd) for _orig, nuevo, en_bd in rows]


# --- Fix actual (producción) ------------------------------------------------


def test_preview_column_rename_maps_by_file_index_not_first_code_match(monkeypatch, tmp_path) -> None:
    names = ["4210502 (1).jpg", "4210502 (2).jpg", "4210502 (3).jpg"]
    files = [str(tmp_path / name) for name in names]
    for path in files:
        Path(path).write_text("x")

    db_rows = [
        {"nis": "ROW0", "sgio": "SGIO_A"},
        {"nis": "ROW1", "sgio": "SGIO_B"},
        {"nis": "ROW2", "sgio": "SGIO_C"},
    ]
    monkeypatch.setattr(
        "backend.core.database.obtener_todos",
        lambda limit=None, offset=0: db_rows[:limit] if limit is not None else db_rows,
    )

    result = conversion.preview({
        "files": files,
        "patron": "{sgio}_{seq}{ext}",
        "secuencia": 1,
        "use_column_rename": True,
        "sequence_mode": "global",
        "use_filename_seq": True,
    })

    assert [item["nuevo"] for item in result["preview"]] == [
        "SGIO_A_001.jpg",
        "SGIO_B_002.jpg",
        "SGIO_C_003.jpg",
    ]
    assert [item["en_bd"] for item in result["preview"]] == [True, True, True]


def test_preview_column_rename_sin_fila_bd_conserva_nombre(monkeypatch, tmp_path) -> None:
    names = ["4210502 (1).jpg", "4210502 (2).jpg", "4210502 (3).jpg"]
    files = [str(tmp_path / name) for name in names]
    for path in files:
        Path(path).write_text("x")

    db_rows = [
        {"nis": "ROW0", "sgio": "SGIO_A"},
        {"nis": "ROW1", "sgio": "SGIO_B"},
    ]
    monkeypatch.setattr(
        "backend.core.database.obtener_todos",
        lambda limit=None, offset=0: db_rows[:limit] if limit is not None else db_rows,
    )

    result = conversion.preview({
        "files": files,
        "patron": "{sgio}_{seq}{ext}",
        "secuencia": 1,
        "use_column_rename": True,
        "sequence_mode": "global",
        "use_filename_seq": True,
    })

    assert [item["nuevo"] for item in result["preview"]] == [
        "SGIO_A_001.jpg",
        "SGIO_B_002.jpg",
        "4210502 (3).jpg",
    ]
    assert [item["en_bd"] for item in result["preview"]] == [True, True, False]


def test_preview_column_rename_record_mode_usa_fila_correcta_por_indice(monkeypatch, tmp_path) -> None:
    """Cada archivo toma su fila BD; la secuencia record agrupa por código parseado (mismo grupo)."""
    names = ["4210502 (1).jpg", "4210544 (2).jpg", "4210502 (3).jpg"]
    files = [str(tmp_path / name) for name in names]
    for path in files:
        Path(path).write_text("x")

    db_rows = [
        {"nis": "4210502", "sgio": "SGIO_A"},
        {"nis": "4210544", "sgio": "SGIO_B"},
        {"nis": "4210502", "sgio": "SGIO_A"},
    ]
    monkeypatch.setattr(
        "backend.core.database.obtener_todos",
        lambda limit=None, offset=0: db_rows[:limit] if limit is not None else db_rows,
    )

    result = conversion.preview({
        "files": files,
        "patron": "{sgio}_{seq}{ext}",
        "secuencia": 1,
        "use_column_rename": True,
        "sequence_mode": "record",
        "use_filename_seq": False,
    })

    assert [item["nuevo"] for item in result["preview"]] == [
        "SGIO_A_001.jpg",
        "SGIO_B_001.jpg",
        "SGIO_A_002.jpg",
    ]
    assert [item["en_bd"] for item in result["preview"]] == [True, True, True]


# --- Lookup roto (validación histórica, no producción) ------------------------


def test_broken_lookup_codigos_duplicados_nunca_devuelve_none() -> None:
    db_rows = [
        {"nis": "ROW0", "sgio": "SGIO_A"},
        {"nis": "ROW1", "sgio": "SGIO_B"},
    ]
    lookup = _broken_lookup(["4210502", "4210502"], db_rows)

    assert lookup("4210502") == db_rows[0]
    assert lookup("4210502") == db_rows[0]
    assert lookup("4210502") is not None


def test_broken_preview_tres_archivos_mismo_codigo_usa_siempre_fila_cero(tmp_path) -> None:
    names = ["4210502 (1).jpg", "4210502 (2).jpg", "4210502 (3).jpg"]
    files = [str(tmp_path / name) for name in names]
    db_rows = [
        {"nis": "ROW0", "sgio": "SGIO_A"},
        {"nis": "ROW1", "sgio": "SGIO_B"},
        {"nis": "ROW2", "sgio": "SGIO_C"},
    ]

    preview = _preview_via_broken_lookup(files, db_rows)

    assert preview == [
        ("SGIO_A_001.jpg", True),
        ("SGIO_A_002.jpg", True),
        ("SGIO_A_003.jpg", True),
    ]


def test_broken_preview_mas_archivos_que_filas_tercero_tambien_usa_fila_cero(tmp_path) -> None:
    """Valida la fila del resumen: con lookup roto el archivo 3 NO obtiene datos=None."""
    names = ["4210502 (1).jpg", "4210502 (2).jpg", "4210502 (3).jpg"]
    files = [str(tmp_path / name) for name in names]
    db_rows = [
        {"nis": "ROW0", "sgio": "SGIO_A"},
        {"nis": "ROW1", "sgio": "SGIO_B"},
    ]

    preview = _preview_via_broken_lookup(files, db_rows)

    assert preview == [
        ("SGIO_A_001.jpg", True),
        ("SGIO_A_002.jpg", True),
        ("SGIO_A_003.jpg", True),
    ]
    assert all(en_bd for _nuevo, en_bd in preview)


def test_broken_lookup_codigo_fuera_de_lista_devuelve_none() -> None:
    lookup = _broken_lookup(["IMG", "IMG"], [{"sgio": "A"}])

    assert lookup("IMG_1") is None


def test_broken_preview_fallback_stem_distinto_al_grupo_da_datos_none_en_record(tmp_path) -> None:
    """codigo not in codigos_list: fallback obtener_codigo_desde_nombre usa stem completo."""
    names = ["IMG_1.jpg", "IMG_2.jpg"]
    files = [str(tmp_path / name) for name in names]
    db_rows = [
        {"nis": "ROW0", "sgio": "SGIO_A"},
        {"nis": "ROW1", "sgio": "SGIO_B"},
    ]

    preview = _preview_via_broken_lookup(
        files,
        db_rows,
        codigos_manuales={},
        sequence_mode="record",
        autofill_codigos_manuales=False,
    )

    assert preview == [
        ("IMG_1.jpg", False),
        ("IMG_2.jpg", False),
    ]


def test_flujo_normal_siempre_usa_codigos_manuales_no_fallback(tmp_path) -> None:
    """En preview real, codigos_manuales se llena antes del loop: el fallback no aplica."""
    names = ["IMG_1.jpg"]
    files = [str(tmp_path / name) for name in names]
    for path in files:
        Path(path).write_text("x")

    code, _seq = parse_filename_parts("IMG_1.jpg")
    assert code == "IMG"

    engine = RenamerEngine("{sgio}_{seq}{ext}", 1)
    lookup = _broken_lookup([code], [{"sgio": "OK"}])
    rows = engine.preview_lote(
        files,
        lookup_fn=lookup,
        codigos_manuales={"IMG_1.jpg": code},
        file_seqs={"IMG_1.jpg": "1"},
    )

    assert rows == [(files[0], "OK_1.jpg", True)]


# --- Proceso (_prepare_chunk_tasks + job completo) -----------------------------


def test_prepare_chunk_tasks_column_rename_mapea_por_indice(monkeypatch, tmp_path) -> None:
    names = ["4210502 (1).jpg", "4210502 (2).jpg", "4210502 (3).jpg"]
    files = [str(tmp_path / name) for name in names]
    db_rows = [
        {"nis": "ROW0", "sgio": "SGIO_A"},
        {"nis": "ROW1", "sgio": "SGIO_B"},
    ]
    monkeypatch.setattr(
        "backend.core.database.obtener_todos",
        lambda limit=None, offset=0: _slice_db_rows(db_rows, limit, offset),
    )
    engine = RenamerEngine("{sgio}_{seq}{ext}", 1, sequence_mode="global")

    tasks = conversion._prepare_chunk_tasks(
        files,
        destino=str(tmp_path / "out"),
        engine=engine,
        conversion_enabled=False,
        ext_dest=None,
        lookup_fn=lambda _codigos: {},
        use_column_rename=True,
        global_offset=0,
        key_column="",
    )

    assert [task[1].name for task in tasks] == [
        "SGIO_A_001.jpg",
        "SGIO_B_002.jpg",
        "4210502 (3).jpg",
    ]


def test_prepare_chunk_tasks_column_rename_codigos_duplicados_por_indice(
    monkeypatch, tmp_path
) -> None:
    names = ["4210502 (1).jpg", "4210502 (2).jpg", "4210502 (3).jpg"]
    files = [str(tmp_path / name) for name in names]
    db_rows = [
        {"nis": "ROW0", "sgio": "SGIO_A"},
        {"nis": "ROW1", "sgio": "SGIO_B"},
        {"nis": "ROW2", "sgio": "SGIO_C"},
    ]
    monkeypatch.setattr(
        "backend.core.database.obtener_todos",
        lambda limit=None, offset=0: _slice_db_rows(db_rows, limit, offset),
    )
    engine = RenamerEngine("{sgio}_{seq}{ext}", 1, sequence_mode="global")

    tasks = conversion._prepare_chunk_tasks(
        files,
        destino=str(tmp_path / "out"),
        engine=engine,
        conversion_enabled=False,
        ext_dest=None,
        lookup_fn=lambda _codigos: {},
        use_column_rename=True,
        global_offset=0,
        key_column="",
    )

    assert [task[1].name for task in tasks] == [
        "SGIO_A_001.jpg",
        "SGIO_B_002.jpg",
        "SGIO_C_003.jpg",
    ]


def test_conversion_column_rename_tercer_archivo_sin_fila(monkeypatch, tmp_path) -> None:
    src = tmp_path / "in"
    dst = tmp_path / "out"
    src.mkdir()
    dst.mkdir()
    names = ["4210502 (1).jpg", "4210502 (2).jpg", "4210502 (3).jpg"]
    files = [str(src / name) for name in names]
    for path in files:
        Path(path).write_text("x")

    db_rows = [
        {"nis": "ROW0", "sgio": "SGIO_A"},
        {"nis": "ROW1", "sgio": "SGIO_B"},
    ]
    scheduler = _RecordingScheduler()
    monkeypatch.setattr(conversion, "get_scheduler", lambda: scheduler)
    monkeypatch.setattr(conversion, "es_video", lambda _path: False)
    monkeypatch.setattr(conversion, "copiar_archivo", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 10)
    monkeypatch.setattr(conversion, "_notify_complete", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("backend.core.history.save_run", lambda **_kwargs: None)
    monkeypatch.setattr(
        "backend.core.database.obtener_todos",
        lambda limit=None, offset=0: _slice_db_rows(db_rows, limit, offset),
    )

    job = Job(id="column-rename-short-db", job_type="conversion", params={
        "files": files,
        "destino": str(dst),
        "formato": "JPEG",
        "conversion_enabled": False,
        "usar_rename": True,
        "patron": "{sgio}_{seq}{ext}",
        "use_column_rename": True,
        "sequence_mode": "global",
        "use_filename_seq": True,
        "secuencia": 1,
    })
    conversion._run_conversion_job(job)

    assert [task[1].name for task in scheduler.submitted] == [
        "SGIO_A_001.jpg",
        "SGIO_B_002.jpg",
        "4210502 (3).jpg",
    ]


def test_conversion_column_rename_tercer_archivo_sin_fila_entre_chunks(monkeypatch, tmp_path) -> None:
    """Con chunking, global_offset debe seguir el índice global aunque la BD sea corta."""
    src = tmp_path / "in"
    dst = tmp_path / "out"
    src.mkdir()
    dst.mkdir()
    names = ["4210502 (1).jpg", "4210502 (2).jpg", "4210502 (3).jpg"]
    files = [str(src / name) for name in names]
    for path in files:
        Path(path).write_text("x")

    db_rows = [
        {"nis": "ROW0", "sgio": "SGIO_A"},
        {"nis": "ROW1", "sgio": "SGIO_B"},
    ]
    scheduler = _RecordingScheduler()
    monkeypatch.setattr(conversion, "get_scheduler", lambda: scheduler)
    monkeypatch.setattr(conversion, "es_video", lambda _path: False)
    monkeypatch.setattr(conversion, "copiar_archivo", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 2)
    monkeypatch.setattr(conversion, "_notify_complete", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("backend.core.history.save_run", lambda **_kwargs: None)
    monkeypatch.setattr(
        "backend.core.database.obtener_todos",
        lambda limit=None, offset=0: _slice_db_rows(db_rows, limit, offset),
    )

    job = Job(id="column-rename-chunked", job_type="conversion", params={
        "files": files,
        "destino": str(dst),
        "formato": "JPEG",
        "conversion_enabled": False,
        "usar_rename": True,
        "patron": "{sgio}_{seq}{ext}",
        "use_column_rename": True,
        "sequence_mode": "global",
        "use_filename_seq": True,
        "secuencia": 1,
    })
    conversion._run_conversion_job(job)

    assert [task[1].name for task in scheduler.submitted] == [
        "SGIO_A_001.jpg",
        "SGIO_B_002.jpg",
        "4210502 (3).jpg",
    ]
