from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

from backend.core.editor import filters
from backend.core.editor.toolchain import probe_json, resolve_toolchain

BUILD_DIR = os.environ.get("ANTARES_FFMPEG_DIR", "")
pytestmark = pytest.mark.skipif(
    not BUILD_DIR or not Path(BUILD_DIR, "ffmpeg.exe").is_file(),
    reason="sin build FFmpeg preparado (ANTARES_FFMPEG_DIR)",
)

SCRATCH = Path(os.environ.get("TMPDIR", ".")) / "editor-filters-tests"


@pytest.fixture(scope="module")
def clip() -> Path:
    from backend.core.editor.toolchain import synthesize_test_clip

    SCRATCH.mkdir(parents=True, exist_ok=True)
    return synthesize_test_clip(resolve_toolchain(), SCRATCH / "clip_synth.mp4")


@pytest.fixture(scope="module")
def toolchain() -> Any:
    return resolve_toolchain()


def _run_filter(toolchain: Any, source: Path, vf: str, output: Path, *, extra: list[str] | None = None) -> None:
    import subprocess

    proc = subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-i",
            str(source),
            "-vf",
            vf,
            * (extra or []),
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-an",
            str(output),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=120,
        check=False,
    )
    assert proc.returncode == 0, f"ffmpeg rechazó el filtro: {proc.stderr[-400:]}"
    assert output.is_file()


def test_num_formats_integers_without_decimals() -> None:
    assert filters._num(2.0) == "2"
    assert filters._num(0.5) == "0.5"


def test_atempo_chain_covers_extremes() -> None:
    assert filters._atempo_chain(1.0) == [1.0]
    assert filters._atempo_chain(4.0) == [2.0, 2.0]
    assert filters._atempo_chain(0.25) == [0.5, 0.5]
    assert all(0.5 <= f <= 2.0 for f in filters._atempo_chain(0.3))


def test_even_rounds_down_to_even() -> None:
    assert filters._even(101) == 100
    assert filters._even(100) == 100


def test_trim_video_produces_shorter_output(toolchain: Any, clip: Path) -> None:
    out = SCRATCH / "trim.mp4"
    _run_filter(toolchain, clip, filters.trim_video(1_000_000, 3_000_000), out)
    meta = probe_json(toolchain, out)
    duration = float(meta["format"]["duration"])
    assert 1.9 <= duration <= 2.1, f"duración inesperada: {duration}"


def test_crop_keeps_even_pixels(toolchain: Any, clip: Path) -> None:
    out = SCRATCH / "crop.mp4"
    _run_filter(toolchain, clip, filters.crop(0.25, 0.25, 0.5, 0.5, 320, 240), out)
    meta = probe_json(toolchain, out)
    video = meta["streams"][0]
    assert video["width"] == 160 and video["height"] == 120
    assert video["width"] % 2 == 0 and video["height"] % 2 == 0


def test_rotate_quarter_turns_work(toolchain: Any, clip: Path) -> None:
    for deg in (90, 180, 270):
        out = SCRATCH / f"rot{deg}.mp4"
        _run_filter(toolchain, clip, filters.rotate(deg), out)
        assert out.is_file()


def test_rotate_free_angle_works(toolchain: Any, clip: Path) -> None:
    out = SCRATCH / "rotfree.mp4"
    _run_filter(toolchain, clip, filters.rotate(15.0), out)
    assert out.is_file()


def test_flip_both_axes(toolchain: Any, clip: Path) -> None:
    out = SCRATCH / "flip.mp4"
    _run_filter(toolchain, clip, filters.flip(True, True), out)
    assert out.is_file()


def test_fit_canvas_letterboxes_center(toolchain: Any, clip: Path) -> None:
    out = SCRATCH / "fit.mp4"
    _run_filter(toolchain, clip, filters.fit_canvas(320, 240, 640, 360, "fit"), out)
    meta = probe_json(toolchain, out)
    video = meta["streams"][0]
    assert video["width"] == 640 and video["height"] == 360


def test_fit_canvas_fill_crops(toolchain: Any, clip: Path) -> None:
    out = SCRATCH / "fill.mp4"
    _run_filter(toolchain, clip, filters.fit_canvas(320, 240, 640, 360, "fill"), out)
    meta = probe_json(toolchain, out)
    video = meta["streams"][0]
    assert video["width"] == 640 and video["height"] == 360


def test_opacity_alpha_mixer(toolchain: Any, clip: Path) -> None:
    out = SCRATCH / "opacity.mp4"
    _run_filter(toolchain, clip, filters.opacity(0.5), out)
    assert out.is_file()


def test_delogo_rects_apply_on_real_clip(toolchain: Any, clip: Path) -> None:
    rects = [{"id": "r1", "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2}]
    chain = ",".join(filters.delogo_rects(rects, 320, 240))
    out = SCRATCH / "delogo.mp4"
    _run_filter(toolchain, clip, chain, out)
    assert out.is_file()


def test_delogo_rejects_tiny_rect() -> None:
    with pytest.raises(ValueError, match="pequeña"):
        filters.delogo_rects([{"id": "r", "x": 0.5, "y": 0.5, "width": 0.01, "height": 0.01}], 320, 240)


def test_delogo_rejects_out_of_bounds_rect() -> None:
    with pytest.raises(ValueError, match="excede"):
        filters.delogo_rects([{"id": "r", "x": 0.9, "y": 0.9, "width": 0.3, "height": 0.3}], 320, 240)


def test_speed_half_doubles_duration(toolchain: Any, clip: Path) -> None:
    out = SCRATCH / "slow.mp4"
    vf = filters.speed(1, 2, has_audio=False)
    _run_filter(toolchain, clip, vf, out)
    meta = probe_json(toolchain, out)
    duration = float(meta["format"]["duration"])
    assert 9.5 <= duration <= 10.5, f"duración inesperada: {duration}"


def test_speed_double_halves_duration(toolchain: Any, clip: Path) -> None:
    out = SCRATCH / "fast.mp4"
    vf = filters.speed(2, 1, has_audio=False)
    _run_filter(toolchain, clip, vf, out)
    meta = probe_json(toolchain, out)
    duration = float(meta["format"]["duration"])
    assert 2.3 <= duration <= 2.7, f"duración inesperada: {duration}"


def test_audio_fades_chain(toolchain: Any, clip: Path) -> None:
    out = SCRATCH / "fades.m4a"
    vf = filters.audio_fades(500_000, 500_000, 5_000_000)
    assert "afade=t=in" in vf and "afade=t=out" in vf
    import subprocess

    proc = subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-i",
            str(clip),
            "-af",
            vf,
            "-c:a",
            "aac",
            str(out),
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr[-300:]
    assert out.is_file()


def test_audio_gain_db(toolchain: Any, clip: Path) -> None:
    assert filters.audio_gain(0) == ""
    assert "volume=" in filters.audio_gain(-6)


def test_metadata_of_overlay_output_matches_canvas(toolchain: Any, clip: Path) -> None:
    out = SCRATCH / "overlay_meta.mp4"
    _run_filter(toolchain, clip, filters.fit_canvas(320, 240, 640, 360, "fit"), out)
    meta = probe_json(toolchain, out)
    assert json.loads(json.dumps(meta))["format"]["format_name"].startswith("mov,mp4")
