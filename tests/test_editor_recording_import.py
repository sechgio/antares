import subprocess
from pathlib import Path

import pytest

from backend.core.editor.assets import AssetImportError, import_file
from backend.core.editor.toolchain import resolve_toolchain

FFMPEG = Path("C:/Users/Enzon/AppData/Local/hermes/tools/ffmpeg-9.0.1-win32-x64/bin/ffmpeg.exe")
pytestmark = pytest.mark.skipif(not FFMPEG.is_file(), reason="build FFmpeg no disponible")


def _make_recording(tmp_path: Path, name: str = "rec-1.webm") -> Path:
    toolchain = resolve_toolchain()
    recording = tmp_path / name
    subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x240:rate=25:duration=2",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2",
            "-c:v",
            "libvpx-vp9",
            "-c:a",
            "libopus",
            str(recording),
        ],
        capture_output=True,
        timeout=180,
        check=True,
    )
    return recording


def test_recording_is_validated_before_import(tmp_path: Path) -> None:
    recording = _make_recording(tmp_path)
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir()
    asset = import_file(str(recording), assets_dir=assets_dir)
    assert asset["displayName"] == "rec-1.webm"
    assert asset["durationUs"] > 1_000_000

    stored = next(f for f in assets_dir.iterdir() if f.suffix == ".webm")
    assert stored.is_file()
    toolchain = resolve_toolchain()
    meta = subprocess.run(
        [
            str(toolchain.ffprobe),
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "csv=p=0",
            str(stored),
        ],
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )
    assert "video" in meta.stdout and "audio" in meta.stdout


def test_empty_recording_is_rejected(tmp_path: Path) -> None:
    empty = tmp_path / "vacio.webm"
    empty.write_bytes(b"")
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir()
    with pytest.raises(AssetImportError):
        import_file(str(empty), assets_dir=assets_dir)
    assert not any(assets_dir.iterdir())


def test_truncated_recording_is_rejected(tmp_path: Path) -> None:
    bad = tmp_path / "roto.webm"
    bad.write_bytes(bytes([0x1A, 0x45, 0xDF, 0xA3]) + b"garbage" * 16)
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir()
    with pytest.raises(AssetImportError):
        import_file(str(bad), assets_dir=assets_dir)


def test_unknown_extension_is_rejected(tmp_path: Path) -> None:
    weird = tmp_path / "nota.exe"
    weird.write_bytes(b"MZ")
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir()
    with pytest.raises(AssetImportError, match="extensión no admitida"):
        import_file(str(weird), assets_dir=assets_dir)
