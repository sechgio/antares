from __future__ import annotations

import base64

import pytest

from backend.handlers.optimizer import image_optimizer_save_files


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

    assert result["saved_count"] == 2
    assert (tmp_path / "passwd").read_bytes() == b"x"
    assert (tmp_path / "valid.png").read_bytes() == b"ok"
    assert not (tmp_path.parent.parent / "etc" / "passwd").exists()


def test_image_optimizer_save_files_dedupes_when_multiple_preexisting_files_collide(tmp_path) -> None:
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
    assert (tmp_path / "foto.jpg").read_bytes() == b"old-1"
    assert (tmp_path / "foto-2.jpg").read_bytes() == b"old-2"
    assert (tmp_path / "foto-3.jpg").read_bytes() == b"old-3"
    assert (tmp_path / "foto-4.jpg").read_bytes() == b"new-a"
    assert (tmp_path / "foto-5.jpg").read_bytes() == b"new-b"


def test_image_optimizer_save_files_skips_when_too_many_collisions_preexist(tmp_path) -> None:
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
    assert (tmp_path / "foto.jpg").read_bytes() == b"old"


def test_image_optimizer_save_files_skips_malformed_base64_instead_of_aborting(tmp_path) -> None:
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
