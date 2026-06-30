from __future__ import annotations

import base64
import zipfile
from io import BytesIO

import pytest

from backend.handlers.optimizer import image_optimizer_save_files, image_optimizer_zip


def _zip_names(result: dict[str, str]) -> list[str]:
    zip_bytes = base64.b64decode(result["zip_base64"])
    with zipfile.ZipFile(BytesIO(zip_bytes)) as zip_file:
        return sorted(zip_file.namelist())


def test_image_optimizer_zip_exports_safe_basenames_at_zip_root() -> None:
    payload = {
        "zip_name": "imagenes optimizadas.zip",
        "files": [
            {
                "filename": "C:/clientes/lote-a/foto.jpg",
                "content_b64": base64.b64encode(b"jpg").decode("ascii"),
            },
            {
                "filename": r"D:\clientes\lote-b\logo.png",
                "content_b64": base64.b64encode(b"png").decode("ascii"),
            },
            {
                "filename": "../temporal/icono.webp",
                "content_b64": base64.b64encode(b"webp").decode("ascii"),
            },
        ],
    }

    result = image_optimizer_zip(payload)

    assert result["filename"] == "imagenes_optimizadas.zip"
    assert _zip_names(result) == [
        "imagenes_optimizadas/foto.jpg",
        "imagenes_optimizadas/icono.webp",
        "imagenes_optimizadas/logo.png",
    ]


def test_image_optimizer_zip_keeps_pre_renamed_photos_at_zip_root() -> None:
    payload = {
        "zip_name": "fotos_test.zip",
        "files": [
            {"filename": "6280330_1.jfif", "content_b64": base64.b64encode(b"1").decode("ascii")},
            {"filename": "6280330_2.jfif", "content_b64": base64.b64encode(b"2").decode("ascii")},
            {"filename": "70021323_4.jpeg", "content_b64": base64.b64encode(b"3").decode("ascii")},
        ],
    }

    result = image_optimizer_zip(payload)

    assert result["filename"] == "fotos_test.zip"
    assert _zip_names(result) == [
        "fotos_test/6280330_1.jfif",
        "fotos_test/6280330_2.jfif",
        "fotos_test/70021323_4.jpeg",
    ]


def test_image_optimizer_zip_deduplicates_colliding_archive_names() -> None:
    payload = {
        "zip_name": "fotos",
        "files": [
            {"filename": "C:/lote-a/foto.jpg", "content_b64": base64.b64encode(b"1").decode("ascii")},
            {"filename": "D:/lote-b/foto.jpg", "content_b64": base64.b64encode(b"2").decode("ascii")},
            {"filename": "foto.JPG", "content_b64": base64.b64encode(b"3").decode("ascii")},
        ],
    }

    result = image_optimizer_zip(payload)

    assert result["filename"] == "fotos.zip"
    assert _zip_names(result) == ["fotos/foto-2.jpg", "fotos/foto-3.JPG", "fotos/foto.jpg"]


def test_image_optimizer_zip_can_write_many_files_directly_to_disk(tmp_path) -> None:
    output_path = tmp_path / "lote.zip"
    payload = {
        "zip_name": "lote.zip",
        "output_path": str(output_path),
        "files": [
            {
                "filename": f"C:/lote/foto_{index:04}.jpg",
                "content_b64": base64.b64encode(f"img-{index}".encode("ascii")).decode("ascii"),
            }
            for index in range(1000)
        ],
    }

    result = image_optimizer_zip(payload)

    assert result == {"filename": "lote.zip", "saved_path": str(output_path.resolve())}
    with zipfile.ZipFile(output_path) as zip_file:
        names = zip_file.namelist()
        assert len(names) == 1000
        assert names[0] == "lote/foto_0000.jpg"
        assert zip_file.read("lote/foto_0999.jpg") == b"img-999"


def test_image_optimizer_save_files_writes_safe_basenames_to_chosen_folder(tmp_path) -> None:
    payload = {
        "output_folder": str(tmp_path),
        "files": [
            {
                "filename": "C:/clientes/lote-a/foto.jpg",
                "content_b64": base64.b64encode(b"jpg").decode("ascii"),
            },
            {
                "filename": r"D:\clientes\lote-b\logo.png",
                "content_b64": base64.b64encode(b"png").decode("ascii"),
            },
            {
                "filename": "../temporal/icono.webp",
                "content_b64": base64.b64encode(b"webp").decode("ascii"),
            },
        ],
    }

    result = image_optimizer_save_files(payload)

    assert result["saved_count"] == 3
    assert result["skipped_count"] == 0
    assert result["saved_path"] == str(tmp_path.resolve())
    saved_names = {entry["filename"] for entry in result["saved"]}
    assert saved_names == {"foto.jpg", "logo.png", "icono.webp"}
    assert (tmp_path / "foto.jpg").read_bytes() == b"jpg"
    assert (tmp_path / "logo.png").read_bytes() == b"png"
    assert (tmp_path / "icono.webp").read_bytes() == b"webp"


def test_image_optimizer_save_files_never_overwrites_existing_files(tmp_path) -> None:
    # Pre-existing file from a previous run — must not be silently overwritten.
    (tmp_path / "foto.jpg").write_bytes(b"old")

    payload = {
        "output_folder": str(tmp_path),
        "files": [
            {
                "filename": "foto.jpg",
                "content_b64": base64.b64encode(b"new").decode("ascii"),
            },
            {
                "filename": "foto.jpg",
                "content_b64": base64.b64encode(b"new2").decode("ascii"),
            },
        ],
    }

    result = image_optimizer_save_files(payload)

    assert result["saved_count"] == 2
    # The pre-existing file is preserved, new ones are deduped alongside.
    assert (tmp_path / "foto.jpg").read_bytes() == b"old"
    assert (tmp_path / "foto-2.jpg").read_bytes() == b"new"
    assert (tmp_path / "foto-3.jpg").read_bytes() == b"new2"


def test_image_optimizer_save_files_rejects_missing_output_folder() -> None:
    payload = {"files": [{"filename": "x.jpg", "content_b64": "eA=="}]}
    with pytest.raises(ValueError, match="output_folder"):
        image_optimizer_save_files(payload)


def test_image_optimizer_save_files_sanitizes_path_traversal_attempts(tmp_path) -> None:
    payload = {
        "output_folder": str(tmp_path),
        "files": [
            {
                "filename": "../../etc/passwd",
                "content_b64": base64.b64encode(b"x").decode("ascii"),
            },
            {
                "filename": "valid.png",
                "content_b64": base64.b64encode(b"ok").decode("ascii"),
            },
        ],
    }

    result = image_optimizer_save_files(payload)

    # The traversal attempt collapses to a safe basename inside the dest folder.
    assert result["saved_count"] == 2
    assert (tmp_path / "passwd").read_bytes() == b"x"
    assert (tmp_path / "valid.png").read_bytes() == b"ok"
    # Nothing escaped the chosen folder.
    assert not (tmp_path.parent.parent / "etc" / "passwd").exists()


def test_image_optimizer_save_files_dedupes_when_multiple_preexisting_files_collide(tmp_path) -> None:
    # Regression guard for the C1 fix: a single retry is not enough when
    # `foto.jpg`, `foto-2.jpg`, and `foto-3.jpg` all pre-exist on disk.
    # The handler must loop until it finds a free slot rather than
    # silently overwriting one of the pre-existing files.
    (tmp_path / "foto.jpg").write_bytes(b"old-1")
    (tmp_path / "foto-2.jpg").write_bytes(b"old-2")
    (tmp_path / "foto-3.jpg").write_bytes(b"old-3")

    payload = {
        "output_folder": str(tmp_path),
        "files": [
            {"filename": "foto.jpg", "content_b64": base64.b64encode(b"new-a").decode("ascii")},
            {"filename": "foto.jpg", "content_b64": base64.b64encode(b"new-b").decode("ascii")},
        ],
    }

    result = image_optimizer_save_files(payload)

    assert result["saved_count"] == 2
    assert result["skipped_count"] == 0
    # The three pre-existing files must be preserved untouched.
    assert (tmp_path / "foto.jpg").read_bytes() == b"old-1"
    assert (tmp_path / "foto-2.jpg").read_bytes() == b"old-2"
    assert (tmp_path / "foto-3.jpg").read_bytes() == b"old-3"
    # The two new files land on the next free slots.
    assert (tmp_path / "foto-4.jpg").read_bytes() == b"new-a"
    assert (tmp_path / "foto-5.jpg").read_bytes() == b"new-b"


def test_image_optimizer_save_files_skips_when_too_many_collisions_preexist(tmp_path) -> None:
    # Safeguard for the bounded dedup loop: if the destination folder already
    # holds MAX_DEDUP_ATTEMPTS+1 colliding files (foto.jpg, foto-2.jpg, ...
    # foto-1001.jpg), the handler must skip the new file with a reason instead
    # of iterating ~1000 times forever (or hanging on a pathological folder).
    from backend.handlers.optimizer import MAX_DEDUP_ATTEMPTS

    for index in range(MAX_DEDUP_ATTEMPTS + 1):
        suffix = "" if index == 0 else f"-{index + 1}"
        (tmp_path / f"foto{suffix}.jpg").write_bytes(b"old")

    payload = {
        "output_folder": str(tmp_path),
        "files": [
            {"filename": "foto.jpg", "content_b64": base64.b64encode(b"new").decode("ascii")},
        ],
    }

    result = image_optimizer_save_files(payload)

    assert result["saved_count"] == 0
    assert result["skipped_count"] == 1
    assert result["skipped"][0]["reason"] == "no_free_slot"
    # None of the pre-existing files were overwritten.
    assert (tmp_path / "foto.jpg").read_bytes() == b"old"


def test_image_optimizer_save_files_skips_malformed_base64_instead_of_aborting(tmp_path) -> None:
    # Regression guard for the A4 fix: a malformed content_b64 used to raise
    # binascii.Error (sub-class of ValueError) which the `except OSError`
    # did not catch, killing the whole batch mid-flight with partial files
    # on disk and no report for the frontend. The handler must now record
    # the bad file as `skipped` and continue with the rest of the batch.
    payload = {
        "output_folder": str(tmp_path),
        "files": [
            {"filename": "good.jpg", "content_b64": base64.b64encode(b"ok").decode("ascii")},
            {"filename": "bad.jpg", "content_b64": "!!!not-base64!!!"},
            {"filename": "also-good.jpg", "content_b64": base64.b64encode(b"also-ok").decode("ascii")},
        ],
    }

    result = image_optimizer_save_files(payload)

    assert result["saved_count"] == 2
    assert result["skipped_count"] == 1
    skipped_names = {entry["filename"] for entry in result["skipped"]}
    assert skipped_names == {"bad.jpg"}
    assert (tmp_path / "good.jpg").read_bytes() == b"ok"
    assert (tmp_path / "also-good.jpg").read_bytes() == b"also-ok"
    assert not (tmp_path / "bad.jpg").exists()
