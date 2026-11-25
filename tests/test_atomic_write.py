from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

import backend.utils.atomic_write as atomic_write
from backend.utils.atomic_write import atomic_output_file


def test_writes_bytes_to_destination(tmp_path: Path) -> None:
    with atomic_output_file(tmp_path / "salida.pdf", extension=".pdf") as target:
        target.tmp_path.write_bytes(b"pdf-bytes")

    assert (tmp_path / "salida.pdf").read_bytes() == b"pdf-bytes"
    assert not target.tmp_path.exists()


def test_appends_extension_when_missing(tmp_path: Path) -> None:
    with atomic_output_file(tmp_path / "salida", extension=".pdf") as target:
        target.tmp_path.write_bytes(b"x")

    assert target.destination.name == "salida.pdf"
    assert target.destination.exists()


def test_extension_check_is_case_insensitive(tmp_path: Path) -> None:
    with atomic_output_file(tmp_path / "SALIDA.PDF", extension=".pdf") as target:
        target.tmp_path.write_bytes(b"x")

    assert target.destination.name == "SALIDA.PDF"


def test_sanitizes_destination_name(tmp_path: Path) -> None:
    with atomic_output_file(tmp_path / "infor:me.pdf", extension=".pdf") as target:
        target.tmp_path.write_bytes(b"x")

    assert target.destination.name == "infor_me.pdf"
    assert target.destination.exists()


def test_rejects_existing_destination_without_overwrite(tmp_path: Path) -> None:
    dest = tmp_path / "salida.pdf"
    dest.write_bytes(b"old")

    with pytest.raises(FileExistsError, match="ya existe"), atomic_output_file(dest, extension=".pdf"):
        pass

    assert dest.read_bytes() == b"old"


def test_custom_exists_message(tmp_path: Path) -> None:
    dest = tmp_path / "salida.pdf"
    dest.write_bytes(b"old")

    with pytest.raises(FileExistsError, match="mensaje propio"), atomic_output_file(
        dest, extension=".pdf", exists_message="mensaje propio {path}"
    ):
        pass


def test_overwrite_replaces_existing(tmp_path: Path) -> None:
    dest = tmp_path / "salida.pdf"
    dest.write_bytes(b"old")

    with atomic_output_file(dest, extension=".pdf", overwrite=True) as target:
        target.tmp_path.write_bytes(b"new")

    assert dest.read_bytes() == b"new"


def test_removes_tmp_on_exception(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="boom"), atomic_output_file(
        tmp_path / "salida.pdf", extension=".pdf"
    ) as target:
        target.tmp_path.write_bytes(b"partial")
        raise RuntimeError("boom")

    assert not target.tmp_path.exists()
    assert not (tmp_path / "salida.pdf").exists()


def test_overwrite_write_failure_preserves_existing(tmp_path: Path) -> None:
    dest = tmp_path / "salida.pdf"
    dest.write_bytes(b"old")

    with pytest.raises(RuntimeError, match="boom"), atomic_output_file(
        dest, extension=".pdf", overwrite=True
    ) as target:
        target.tmp_path.write_bytes(b"partial")
        raise RuntimeError("boom")

    assert dest.read_bytes() == b"old"
    assert not target.tmp_path.exists()


def test_tmp_paths_are_unique(tmp_path: Path) -> None:
    with atomic_output_file(tmp_path / "a.pdf", extension=".pdf") as first:
        first.tmp_path.write_bytes(b"1")
        with atomic_output_file(tmp_path / "b.pdf", extension=".pdf") as second:
            second.tmp_path.write_bytes(b"2")
            assert first.tmp_path != second.tmp_path
            assert first.tmp_path.parent == tmp_path

    assert (tmp_path / "a.pdf").exists()
    assert (tmp_path / "b.pdf").exists()


def test_tmp_name_keeps_destination_prefix(tmp_path: Path) -> None:
    with atomic_output_file(tmp_path / "salida.pdf", extension=".pdf") as target:
        assert target.tmp_path.name.startswith("salida.pdf.")
        assert target.tmp_path.name.endswith(".tmp")
        target.tmp_path.write_bytes(b"x")


def test_symlink_destination_rejected(tmp_path: Path) -> None:
    real = tmp_path / "real.pdf"
    real.write_bytes(b"x")
    link = tmp_path / "link.pdf"
    try:
        link.symlink_to(real)
    except OSError:
        pytest.skip("sin privilegios para crear symlinks")

    with pytest.raises(ValueError, match="symlink"), atomic_output_file(link, extension=".pdf"):
        pass


def test_symlink_parent_rejected(tmp_path: Path) -> None:
    real_dir = tmp_path / "real"
    real_dir.mkdir()
    link_dir = tmp_path / "link"
    try:
        link_dir.symlink_to(real_dir, target_is_directory=True)
    except OSError:
        pytest.skip("sin privilegios para crear symlinks")

    with pytest.raises(ValueError, match="symlink"), atomic_output_file(
        link_dir / "salida.pdf", extension=".pdf"
    ):
        pass


@pytest.mark.skipif(os.name != "nt", reason="las junctions son reparse points de Windows")
def test_directory_junction_parent_rejected(tmp_path: Path) -> None:
    real_dir = tmp_path / "real"
    real_dir.mkdir()
    junction = tmp_path / "junction"
    result = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(junction), str(real_dir)],
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        pytest.skip("no se pudo crear una junction de prueba")

    with pytest.raises(ValueError, match="symlink/reparse"), atomic_output_file(
        junction / "salida.pdf", extension=".pdf"
    ):
        pass


def test_symlink_destination_created_during_write_rejected_before_publish(tmp_path: Path) -> None:
    real = tmp_path / "real.pdf"
    real.write_bytes(b"real")
    dest = tmp_path / "salida.pdf"

    with pytest.raises(ValueError, match="symlink/reparse"), atomic_output_file(
        dest, extension=".pdf", overwrite=True
    ) as target:
        target.tmp_path.write_bytes(b"new")
        try:
            dest.symlink_to(real)
        except OSError:
            pytest.skip("sin privilegios para crear symlinks")

    assert dest.is_symlink()
    assert real.read_bytes() == b"real"


def test_creates_missing_parent_dirs(tmp_path: Path) -> None:
    with atomic_output_file(tmp_path / "sub" / "dir" / "salida.pdf", extension=".pdf") as target:
        target.tmp_path.write_bytes(b"x")

    assert (tmp_path / "sub" / "dir" / "salida.pdf").exists()


def test_write_token_uses_resolved_path_verbatim(tmp_path: Path) -> None:
    resolved = tmp_path / "informe  final.pdf"

    with atomic_output_file(resolved, extension=".pdf", write_token=object()) as target:
        assert target.destination == resolved
        target.tmp_path.write_bytes(b"x")

    assert resolved.exists()


def test_write_token_still_appends_missing_extension(tmp_path: Path) -> None:
    resolved = tmp_path / "salida"

    with atomic_output_file(resolved, extension=".pdf", write_token=object()) as target:
        target.tmp_path.write_bytes(b"x")

    assert target.destination == tmp_path / "salida.pdf"
    assert target.destination.exists()


def test_non_overwrite_publish_fails_if_destination_appears(tmp_path: Path) -> None:
    dest = tmp_path / "salida.pdf"

    with pytest.raises(FileExistsError), atomic_output_file(dest, extension=".pdf") as target:
        target.tmp_path.write_bytes(b"new")
        dest.write_bytes(b"raced")

    assert dest.read_bytes() == b"raced"
    assert not target.tmp_path.exists()


def test_exclusive_tmp_rejects_precreated_temp_file(tmp_path: Path, monkeypatch) -> None:
    fixed_hex = "0" * 32

    class FixedUuid:
        hex = fixed_hex

    monkeypatch.setattr(atomic_write.uuid, "uuid4", lambda: FixedUuid())
    dest = tmp_path / "salida.pdf"
    planted = tmp_path / f"salida.pdf.{fixed_hex}.tmp"
    planted.write_bytes(b"planted")

    with pytest.raises(FileExistsError), atomic_output_file(dest, extension=".pdf"):
        pass

    assert planted.read_bytes() == b"planted"
    assert not dest.exists()


def test_atomic_write_text_rejects_precreated_temp_file(tmp_path: Path, monkeypatch) -> None:
    fixed_hex = "1" * 32

    class FixedUuid:
        hex = fixed_hex

    monkeypatch.setattr(atomic_write.uuid, "uuid4", lambda: FixedUuid())
    dest = tmp_path / "estado.json"
    planted = tmp_path / f"estado.json.{fixed_hex}.tmp"
    planted.write_text("planted", encoding="utf-8")

    with pytest.raises(FileExistsError):
        atomic_write.atomic_write_text(dest, "nuevo")

    assert planted.read_text(encoding="utf-8") == "planted"
    assert not dest.exists()
