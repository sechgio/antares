"""Tests de preview y conversión con mapeo directo."""

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
    assert preview["IMG_0001.jpg"]["en_bd"] is True
    assert preview["IMG_0002.jpg"]["en_bd"] is True
    assert not result.get("collisions")


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
    monkeypatch.setattr(conversion, "copiar_archivo", lambda src_path, out_path: copied.append((str(src_path), str(out_path))))
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
