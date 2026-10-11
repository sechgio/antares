"""Pruebas de la cadena de herramientas multimedia del editor (L0).

Si ``ANTARES_FFMPEG_DIR`` no apunta a un build, las pruebas se saltan:
una suite saltada **no** prueba exportación, solo indica que el entorno
no tiene herramientas preparadas.
"""

from __future__ import annotations

import json
import os
import pathlib

import pytest

from backend.core.editor.toolchain import (
    ToolchainError,
    capabilities,
    list_encoders,
    list_filters,
    probe_json,
    resolve_toolchain,
    synthesize_test_clip,
)

BUILD_DIR = os.environ.get("ANTARES_FFMPEG_DIR", "")
pytestmark = pytest.mark.skipif(
    not BUILD_DIR or not pathlib.Path(BUILD_DIR, "ffmpeg.exe").is_file(),
    reason="sin build FFmpeg preparado (ANTARES_FFMPEG_DIR)",
)

SCRATCH = pathlib.Path(os.environ.get("TMPDIR", ".")) / "editor-toolchain-tests"


def test_resolve_toolchain_finds_prepared_binaries() -> None:
    toolchain = resolve_toolchain()
    assert toolchain.ffmpeg.is_file()
    assert toolchain.ffprobe.is_file()


def test_build_covers_required_filters_and_encoders() -> None:
    caps = capabilities(resolve_toolchain())
    assert caps["missingFilters"] == [], f"filtros ausentes: {caps['missingFilters']}"
    assert caps["missingEncoders"] == [], f"encoders ausentes: {caps['missingEncoders']}"
    assert caps["ok"] is True


def test_delogo_and_stabilization_present() -> None:
    filters = list_filters(resolve_toolchain())
    assert "delogo" in filters
    assert {"vidstabdetect", "vidstabtransform"} <= filters
    assert "rubberband" in filters


def test_mp4_and_webm_encoders_present() -> None:
    encoders = list_encoders(resolve_toolchain())
    assert {"libx264", "aac"} <= encoders  # MP4
    assert {"libvpx-vp9", "libopus"} <= encoders  # WebM


def test_synthetic_clip_probes_with_expected_streams() -> None:
    toolchain = resolve_toolchain()
    out = SCRATCH / "clip_synth.mp4"
    clip = synthesize_test_clip(toolchain, out)
    assert clip.is_file()
    meta = probe_json(toolchain, clip)
    streams = meta["streams"]
    kinds = [s["codec_type"] for s in streams]
    assert kinds == ["video", "audio"]
    video = streams[0]
    assert video["codec_name"] == "h264"
    assert video["width"] == 320 and video["height"] == 240
    audio = streams[1]
    assert audio["codec_name"] == "aac"
    assert audio["sample_rate"] == "48000"
    assert meta["format"]["format_name"].startswith("mov,mp4")


def test_probe_reports_rational_fps() -> None:
    toolchain = resolve_toolchain()
    clip = synthesize_test_clip(toolchain, SCRATCH / "clip_synth.mp4")
    meta = probe_json(toolchain, clip)
    video = meta["streams"][0]
    assert video["r_frame_rate"] == "25/1"


def test_missing_toolchain_raises_clear_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTARES_FFMPEG_DIR", raising=False)
    monkeypatch.delenv("ANTARES_FFMPEG_ALLOW_PATH", raising=False)
    with pytest.raises(ToolchainError, match="prepare-editor-media"):
        resolve_toolchain()


def test_capabilities_json_serializable() -> None:
    caps = capabilities(resolve_toolchain())
    json.dumps(caps)  # el resultado viaja por IPC como JSON
