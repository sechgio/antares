import base64

from backend.utils.image_data import build_image_uris

_TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


def test_build_image_uris_prefers_valid_disk_image_over_inline_payload(tmp_path) -> None:
    image_path = tmp_path / "disk.png"
    image_path.write_bytes(base64.b64decode(_TINY_PNG, validate=True))

    result = build_image_uris(
        {"photo.png": "not-base64", "inline.png": _TINY_PNG},
        {"photo.png": str(image_path), "missing.png": str(tmp_path / "missing.png")},
    )

    assert result["photo.png"].startswith("data:image/png;base64,")
    assert result["inline.png"].startswith("data:image/png;base64,")
    assert "missing.png" not in result
