"""Regression: conversion must not silently overwrite when out_paths collide."""

from __future__ import annotations

from pathlib import Path

from backend.core.jobs import JobManager
from backend.handlers.conversion import _dedupe_chunk_out_paths, _out_path_key


def test_cross_job_reservation_blocks_other_job() -> None:
    """Two jobs must not claim the same normalized out path."""
    mgr = JobManager()
    key = _out_path_key(Path("out/same.jpg"))
    assert mgr.try_reserve_out_path("job_a", key) is True
    assert mgr.try_reserve_out_path("job_b", key) is False
    assert mgr.try_reserve_out_path("job_a", key) is True  # same job re-claim ok
    mgr.release_out_paths("job_a")
    assert mgr.try_reserve_out_path("job_b", key) is True


def test_dedupe_renames_when_other_job_holds_path(monkeypatch) -> None:
    """In-batch dedupe must treat another job's reservation as taken."""
    mgr = JobManager()
    monkeypatch.setattr(
        "backend.handlers.conversion.get_job_manager",
        lambda: mgr,
    )
    key = _out_path_key(Path("out/same.jpg"))
    assert mgr.try_reserve_out_path("job_other", key)

    reserved: set[str] = set()
    result = _dedupe_chunk_out_paths(
        [("a.jpg", Path("out/same.jpg"), False)],
        reserved,
        job_id="job_mine",
    )
    assert result[0][1] == Path("out/same-2.jpg")
    assert mgr.get_out_path_owner(_out_path_key(Path("out/same-2.jpg"))) == "job_mine"


def test_dedupe_leaves_unique_paths_unchanged() -> None:
    tasks = [
        ("a.jpg", Path("out/a.jpg"), False),
        ("b.jpg", Path("out/b.jpg"), False),
    ]
    reserved: set[str] = set()
    result = _dedupe_chunk_out_paths(tasks, reserved)
    assert result == tasks
    assert _out_path_key(Path("out/a.jpg")) in reserved
    assert _out_path_key(Path("out/b.jpg")) in reserved


def test_dedupe_suffixes_colliding_out_paths() -> None:
    tasks = [
        ("folder1/a.jpg", Path("out/a.jpg"), False),
        ("folder2/a.jpg", Path("out/a.jpg"), False),
        ("folder3/a.jpg", Path("out/a.jpg"), False),
    ]
    logs: list[str] = []
    reserved: set[str] = set()
    result = _dedupe_chunk_out_paths(tasks, reserved, log=logs.append)

    assert result[0][1] == Path("out/a.jpg")
    assert result[1][1] == Path("out/a-2.jpg")
    assert result[2][1] == Path("out/a-3.jpg")
    assert len(logs) == 2
    assert all("Colisión de salida" in msg for msg in logs)


def test_dedupe_is_case_insensitive() -> None:
    # Forward slashes keep pathlib consistent on Windows and Linux CI.
    # The auto-suffix keeps the colliding path's own stem/suffix casing.
    tasks = [
        ("x.jpg", Path("out/Photo.JPG"), False),
        ("y.jpg", Path("out/photo.jpg"), False),
    ]
    reserved: set[str] = set()
    result = _dedupe_chunk_out_paths(tasks, reserved)
    assert result[0][1] == Path("out/Photo.JPG")
    assert result[1][1] == Path("out/photo-2.jpg")
    assert _out_path_key(result[0][1]) != _out_path_key(result[1][1])
    assert _out_path_key(result[0][1]) == _out_path_key(Path("out/photo.jpg"))


def test_dedupe_falls_back_to_exists_when_disk_keys_is_none(tmp_path) -> None:
    """disk_keys=None must keep path.exists() anti-overwrite behavior."""
    existing = tmp_path / "a.jpg"
    existing.write_bytes(b"old")
    reserved: set[str] = set()
    result = _dedupe_chunk_out_paths(
        [("src/new.jpg", tmp_path / "a.jpg", False)],
        reserved,
        disk_keys=None,
    )
    assert result[0][1] == tmp_path / "a-2.jpg"
    assert existing.read_bytes() == b"old"


def test_dedupe_uses_disk_keys_without_exists(tmp_path, monkeypatch) -> None:
    """Pre-scanned disk_keys must block claims without calling path.exists()."""
    existing = tmp_path / "a.jpg"
    existing.write_bytes(b"old")
    keys = {_out_path_key(existing)}
    exists_calls = {"n": 0}
    real_exists = Path.exists

    def counting_exists(self):  # type: ignore[no-untyped-def]
        exists_calls["n"] += 1
        return real_exists(self)

    monkeypatch.setattr(Path, "exists", counting_exists)
    reserved: set[str] = set()
    result = _dedupe_chunk_out_paths(
        [("src/new.jpg", tmp_path / "a.jpg", False)],
        reserved,
        disk_keys=keys,
    )
    assert result[0][1] == tmp_path / "a-2.jpg"
    assert _out_path_key(tmp_path / "a-2.jpg") in keys
    assert exists_calls["n"] == 0


def test_destination_scan_is_bounded_without_returning_partial_keys(tmp_path, monkeypatch) -> None:
    """A huge destination falls back to exact per-path checks, never a partial snapshot."""
    from backend.handlers import conversion

    destino = tmp_path / "large-destination"
    destino.mkdir()
    (destino / "first.jpg").write_bytes(b"1")
    (destino / "second.jpg").write_bytes(b"2")
    monkeypatch.setattr(conversion, "_MAX_DEST_SCAN_ENTRIES", 1)

    assert conversion._scan_dest_out_keys(destino) is None


def test_destination_scan_cache_is_lru_bounded(tmp_path, monkeypatch) -> None:
    from backend.handlers import conversion

    monkeypatch.setattr(conversion, "_MAX_DEST_SCAN_CACHE", 1)
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir()
    second.mkdir()
    assert conversion._scan_dest_out_keys(first) == set()
    assert conversion._scan_dest_out_keys(second) == set()

    assert len(conversion._dest_scan_cache) <= 1
    assert str(second.resolve()) in conversion._dest_scan_cache


def test_dedupe_spans_chunks_via_shared_reserved_set() -> None:
    reserved: set[str] = set()
    chunk1 = _dedupe_chunk_out_paths(
        [("a.jpg", Path("out/same.png"), False)],
        reserved,
    )
    chunk2 = _dedupe_chunk_out_paths(
        [("b.jpg", Path("out/same.png"), False)],
        reserved,
    )
    assert chunk1[0][1] == Path("out/same.png")
    assert chunk2[0][1] == Path("out/same-2.png")


def test_preview_catalog_applies_out_path_dedupe_suffixes(monkeypatch, tmp_path) -> None:
    """Catalog preview must show -2/-3 like process, not colliding bare names."""
    from backend.handlers import conversion

    files = [str(tmp_path / "a.jpg"), str(tmp_path / "b.jpg")]
    for f in files:
        Path(f).write_text("x")

    monkeypatch.setattr(
        "backend.core.database.buscar_lote_por_codigos",
        lambda _codes: {
            "a": {"codigo": "a", "nombre": "mismo"},
            "b": {"codigo": "b", "nombre": "mismo"},
        },
    )
    monkeypatch.setattr("backend.core.renamer.get_field_names", lambda: ["codigo", "nombre"])

    result = conversion.preview({
        "files": files,
        "patron": "{nombre}{ext}",
        "secuencia": 1,
        "sequence_mode": "global",
        "use_filename_seq": False,
    })
    nuevos = [item["nuevo"] for item in result["preview"]]
    assert nuevos == ["mismo.jpg", "mismo-2.jpg"]
    assert "collisions" not in result


def test_preview_mapping_still_reports_collisions_without_suffix(tmp_path) -> None:
    """Mapping preview must NOT auto-suffix; process aborts on collisions."""
    from backend.handlers import conversion

    files = [str(tmp_path / "A.jpg"), str(tmp_path / "B.jpg")]
    for f in files:
        Path(f).write_text("x")

    result = conversion.preview({
        "files": files,
        "patron": "",
        "mapping": {"A.jpg": "mismo", "B.jpg": "mismo"},
    })
    nuevos = {item["origen"]: item["nuevo"] for item in result["preview"]}
    assert nuevos["A.jpg"] == "mismo.jpg"
    assert nuevos["B.jpg"] == "mismo.jpg"
    assert result["collisions"]


def test_preview_dedupe_sees_pre_existing_destino_files(monkeypatch, tmp_path) -> None:
    """B2: el preview debe mostrar -2 cuando el nombre YA existe en destino.
    El job escanea destino (disk_keys) antes de deduplicar; el preview no lo
    hacía y mostraba el nombre pelado, divergiendo del resultado real."""
    from backend.handlers import conversion

    destino = tmp_path / "salida"
    destino.mkdir()
    (destino / "mismo.jpg").write_text("ya existe")

    source = tmp_path / "a.jpg"
    source.write_text("x")

    monkeypatch.setattr(
        "backend.core.database.buscar_lote_por_codigos",
        lambda _codes: {"a": {"codigo": "a", "nombre": "mismo"}},
    )
    monkeypatch.setattr("backend.core.renamer.get_field_names", lambda: ["codigo", "nombre"])

    result = conversion.preview({
        "files": [str(source)],
        "patron": "{nombre}{ext}",
        "secuencia": 1,
        "sequence_mode": "global",
        "use_filename_seq": False,
        "destino": str(destino),
    })
    assert [item["nuevo"] for item in result["preview"]] == ["mismo-2.jpg"]


def test_preview_without_destino_never_consults_cwd_exists(monkeypatch, tmp_path) -> None:
    """B2: sin destino el dedupe del preview debe ser solo en memoria. Antes,
    _claim_out_path caía a Path.exists() sobre nombres pelados resueltos contra
    el CWD del backend — una carpeta sin relación con la salida real."""
    from backend.handlers import conversion

    files = [str(tmp_path / "a.jpg"), str(tmp_path / "b.jpg")]
    for f in files:
        Path(f).write_text("x")

    monkeypatch.setattr(
        "backend.core.database.buscar_lote_por_codigos",
        lambda _codes: {
            "a": {"codigo": "a", "nombre": "mismo"},
            "b": {"codigo": "b", "nombre": "mismo"},
        },
    )
    monkeypatch.setattr("backend.core.renamer.get_field_names", lambda: ["codigo", "nombre"])

    def no_exists(self: Path) -> bool:
        if not self.is_absolute():
            raise AssertionError(
                f"preview sin destino no debe consultar exists() sobre rutas relativas: {self}"
            )
        return real_exists(self)

    real_exists = Path.exists
    monkeypatch.setattr(Path, "exists", no_exists)

    result = conversion.preview({
        "files": files,
        "patron": "{nombre}{ext}",
        "secuencia": 1,
        "sequence_mode": "global",
        "use_filename_seq": False,
    })
    assert [item["nuevo"] for item in result["preview"]] == ["mismo.jpg", "mismo-2.jpg"]
