"""Tests de secuencia por fila de BD en preview y conversion."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.core.jobs import Job
from backend.handlers import conversion


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        ({"sequence_mode": "record", "use_filename_seq": False}, "record"),
        ({"sequence_mode": "global", "use_filename_seq": True}, "global"),
        ({"sequence_mode": "desconocido", "use_filename_seq": True}, "filename"),
        ({"use_filename_seq": False}, "global"),
    ],
)
def test_resuelve_modo_de_secuencia_con_compatibilidad(params, expected) -> None:
    assert conversion._resolve_sequence_mode(params) == expected


def test_preview_reinicia_secuencia_por_fila_en_orden_del_lote(monkeypatch, tmp_path) -> None:
    names = [
        "4210502 (7).jpg",
        "SIN_FILA.jpg",
        "4210544 (9).jpg",
        "4210502 (1).jpg",
        "4210544 (2).jpg",
        "4210544 (5).jpg",
    ]
    files = [str(tmp_path / name) for name in names]
    for path in files:
        Path(path).write_text("x")

    rows = {
        "4210502": {"nis": "4210502", "sgio": "69841274"},
        "4210544": {"nis": "4210544", "sgio": "69841278"},
    }
    monkeypatch.setattr(conversion, "_resolve_key_column", lambda key, _files, _columns, **_kw: key)
    monkeypatch.setattr("backend.core.config_fields.get_field_names", lambda: ["nis", "sgio"])
    monkeypatch.setattr(
        "backend.core.database.buscar_por_columna",
        lambda codes, _column: {code: rows[code] for code in codes if code in rows},
    )

    result = conversion.preview({
        "files": files,
        "patron": "{sgio}_{seq}{ext}",
        "secuencia": 1,
        "sequence_mode": "record",
        "use_filename_seq": True,
        "key_column": "nis",
    })

    assert [item["nuevo"] for item in result["preview"]] == [
        "69841274_001.jpg",
        "SIN_FILA.jpg",
        "69841278_001.jpg",
        "69841274_002.jpg",
        "69841278_002.jpg",
        "69841278_003.jpg",
    ]


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
        self.submitted = []

    def submit_heavy(self, fn, task, *, block=False, cancel_check=None):
        self.submitted.append(task)
        return _ImmediateFuture(fn(task))


def test_conversion_mantiene_secuencia_por_fila_entre_bloques(monkeypatch, tmp_path) -> None:
    src = tmp_path / "in"
    dst = tmp_path / "out"
    src.mkdir()
    dst.mkdir()
    names = ["4210502 (7).jpg", "4210544 (9).jpg", "4210502 (1).jpg", "4210544 (2).jpg"]
    files = [str(src / name) for name in names]
    for path in files:
        Path(path).write_text("x")

    rows = {
        "4210502": {"nis": "4210502", "sgio": "69841274"},
        "4210544": {"nis": "4210544", "sgio": "69841278"},
    }
    scheduler = _RecordingScheduler()
    monkeypatch.setattr(conversion, "get_scheduler", lambda: scheduler)
    monkeypatch.setattr(conversion, "es_video", lambda _path: False)
    monkeypatch.setattr(conversion, "copiar_archivo", lambda *_args: None)
    monkeypatch.setattr(conversion, "_calculate_chunk_size", lambda: 2)
    monkeypatch.setattr(conversion, "_resolve_key_column", lambda key, _files, _columns, **_kw: key)
    monkeypatch.setattr(conversion, "_notify_complete", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("backend.core.history.save_run", lambda **_kwargs: None)
    monkeypatch.setattr("backend.core.config_fields.get_field_names", lambda: ["nis", "sgio"])
    monkeypatch.setattr(
        "backend.core.database.buscar_por_columna",
        lambda codes, _column: {code: rows[code] for code in codes if code in rows},
    )

    job = Job(id="record-seq", job_type="conversion", params={
        "files": files,
        "destino": str(dst),
        "formato": "JPEG",
        "conversion_enabled": False,
        "usar_rename": True,
        "patron": "{sgio}_{seq}{ext}",
        "sequence_mode": "record",
        "use_filename_seq": True,
        "key_column": "nis",
        "secuencia": 1,
    })
    conversion._run_conversion_job(job)

    assert [task[1].name for task in scheduler.submitted] == [
        "69841274_001.jpg",
        "69841278_001.jpg",
        "69841274_002.jpg",
        "69841278_002.jpg",
    ]


def test_preview_archivo_sin_fila_conserva_nombre_y_no_consume_contador(monkeypatch, tmp_path) -> None:
    """Un archivo sin coincidencia en BD conserva su nombre original y no
    consume un numero de secuencia en modo record."""
    names = ["4210502 (7).jpg", "DESCONOCIDO (3).jpg", "4210502 (1).jpg"]
    files = [str(tmp_path / name) for name in names]
    for path in files:
        Path(path).write_text("x")

    rows = {
        "4210502": {"nis": "4210502", "sgio": "69841274"},
    }
    monkeypatch.setattr(conversion, "_resolve_key_column", lambda key, _files, _columns, **_kw: key)
    monkeypatch.setattr("backend.core.config_fields.get_field_names", lambda: ["nis", "sgio"])
    monkeypatch.setattr(
        "backend.core.database.buscar_por_columna",
        lambda codes, _column: {code: rows[code] for code in codes if code in rows},
    )

    result = conversion.preview({
        "files": files,
        "patron": "{sgio}_{seq}{ext}",
        "secuencia": 1,
        "sequence_mode": "record",
        "use_filename_seq": True,
        "key_column": "nis",
    })

    assert [item["nuevo"] for item in result["preview"]] == [
        "69841274_001.jpg",
        "DESCONOCIDO (3).jpg",
        "69841274_002.jpg",
    ]
    assert [item["en_bd"] for item in result["preview"]] == [True, False, True]
