from __future__ import annotations

import base64
import zipfile
from io import BytesIO

from backend.handlers.optimizer import image_optimizer_zip


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
