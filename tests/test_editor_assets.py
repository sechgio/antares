"""Pruebas de importación de assets del editor (L1, plan §4.3).

Los casos con ffprobe requieren un build preparado
(``ANTARES_FFMPEG_DIR``) y se saltan sin él; los de validación de token
y política de archivos corren siempre.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from backend.core.editor.assets import (
    ALLOWED_SUFFIXES,
    AssetImportError,
    import_file,
    large_file_warning,
)


@pytest.fixture()
def assets_dir(tmp_path: Path) -> Path:
    return tmp_path / "assets"


# --- Política de tokens ------------------------------------------------------------


def test_relative_token_rejected(assets_dir: Path) -> None:
    with pytest.raises(AssetImportError, match="absoluta"):
        import_file("media/clip.mp4", assets_dir=assets_dir)


def test_symlink_token_rejected(tmp_path: Path, assets_dir: Path) -> None:
    real = tmp_path / "real.mp4"
    real.write_bytes(b"no es un video real")
    link = tmp_path / "link.mp4"
    link.symlink_to(real)
    with pytest.raises(AssetImportError, match="symlink"):
        import_file(str(link), assets_dir=assets_dir)


def test_disallowed_extension_rejected(tmp_path: Path, assets_dir: Path) -> None:
    bad = tmp_path / "malicioso.exe"
    bad.write_bytes(b"MZ")
    with pytest.raises(AssetImportError, match="extensión"):
        import_file(str(bad), assets_dir=assets_dir)


def test_missing_file_rejected(assets_dir: Path) -> None:
    with pytest.raises(AssetImportError, match="no existe"):
        import_file("C:/no/existe/clip.mp4", assets_dir=assets_dir)


def test_allowed_suffixes_cover_media_formats() -> None:
    for expected in (".mp4", ".mkv", ".mov", ".webm", ".mp3", ".wav", ".png", ".jpg", ".gif"):
        assert expected in ALLOWED_SUFFIXES


# --- Aviso de disco --------------------------------------------------------------------


def test_large_file_warning_over_threshold(tmp_path: Path) -> None:
    big = tmp_path / "grande.mp4"
    big.write_bytes(b"\0" * (600 * 1024 * 1024))
    warning = large_file_warning(big)
    assert warning is not None and "GB" in warning


def test_small_file_no_warning(tmp_path: Path) -> None:
    small = tmp_path / "pequeno.mp4"
    small.write_bytes(b"\0" * 1024)
    assert large_file_warning(small) is None


# --- Copia real con build ffmpeg ------------------------------------------------------


BUILD_DIR = os.environ.get("ANTARES_FFMPEG_DIR", "")
pytestmark_real = pytest.mark.skipif(
    not BUILD_DIR or not Path(BUILD_DIR, "ffmpeg.exe").is_file(),
    reason="sin build FFmpeg preparado (ANTARES_FFMPEG_DIR)",
)


@pytestmark_real
def test_import_registers_asset_with_streams(tmp_path: Path, assets_dir: Path) -> None:
    from backend.core.editor.toolchain import resolve_toolchain, synthesize_test_clip

    toolchain = resolve_toolchain()
    clip = synthesize_test_clip(toolchain, tmp_path / "origen.mp4")
    original_mtime = clip.stat().st_mtime

    asset = import_file(str(clip), assets_dir=assets_dir)

    assert asset["type"] == "video"
    assert asset["byteSize"] == clip.stat().st_size
    assert len(asset["sha256"]) == 64
    assert asset["durationUs"] == 5_000_000
    kinds = [s["kind"] for s in asset["streams"]]
    assert kinds == ["video", "audio"]
    video = asset["streams"][0]
    assert video["width"] == 320 and video["height"] == 240
    assert video["sar"] == {"num": 1, "den": 1}
    assert video["orientation"] == "landscape"

    # El archivo original no se mueve ni se borra.
    assert clip.is_file()
    assert clip.stat().st_mtime == original_mtime

    # El asset queda registrado junto al binario copiado.
    index = assets_dir / f"{asset['id']}.json"
    assert index.is_file()
    copied = assets_dir / f"{asset['id']}.mp4"
    assert copied.is_file()
    registered = json.loads(index.read_text(encoding="utf-8"))
    assert registered["sha256"] == asset["sha256"]


@pytestmark_real
def test_truncated_source_is_rejected(tmp_path: Path, assets_dir: Path) -> None:
    from backend.core.editor.toolchain import resolve_toolchain, synthesize_test_clip

    toolchain = resolve_toolchain()
    clip = synthesize_test_clip(toolchain, tmp_path / "origen.mp4")
    data = clip.read_bytes()
    truncated = tmp_path / "truncado.mp4"
    truncated.write_bytes(data[: len(data) // 2])
    with pytest.raises(AssetImportError, match="truncado"):
        import_file(str(truncated), assets_dir=assets_dir)


@pytestmark_real
def test_valid_png_imports_as_image_asset(tmp_path: Path, assets_dir: Path) -> None:
    from backend.core.editor.toolchain import _run, resolve_toolchain

    toolchain = resolve_toolchain()
    png = tmp_path / "logo.png"
    _run(
        toolchain.ffmpeg,
        ["-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc2=size=64x48:rate=1:duration=1", "-frames:v", "1", str(png)],
    )
    asset = import_file(str(png), assets_dir=assets_dir)
    assert asset["type"] == "image"
    assert asset["streams"][0]["width"] == 64


# --- Rutas Unicode y espacios (requisito L1.5) ----------------------------------------


@pytestmark_real
def test_unicode_and_spaced_paths_import(tmp_path: Path, assets_dir: Path) -> None:
    from backend.core.editor.toolchain import resolve_toolchain, synthesize_test_clip

    toolchain = resolve_toolchain()
    weird_dir = tmp_path / "carpeta con espacios" / "añó ünïcode"
    weird_dir.mkdir(parents=True)
    clip = synthesize_test_clip(toolchain, weird_dir / "mi vídeo (1).mp4")

    asset = import_file(str(clip), assets_dir=assets_dir)
    assert asset["displayName"] == "mi vídeo (1).mp4"
    assert asset["byteSize"] == clip.stat().st_size
