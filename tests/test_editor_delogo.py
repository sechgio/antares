from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any

import pytest

from backend.core.editor.filters import delogo_rects

BUILD_DIR = os.environ.get("ANTARES_FFMPEG_DIR", "")
pytestmark = pytest.mark.skipif(
    not BUILD_DIR or not Path(BUILD_DIR, "ffmpeg.exe").is_file(),
    reason="sin build FFmpeg preparado (ANTARES_FFMPEG_DIR)",
)

SCRATCH = Path(os.environ.get("TMPDIR", ".")) / "editor-delogo-tests"


@pytest.fixture(scope="module")
def toolchain() -> Any:
    from backend.core.editor.toolchain import resolve_toolchain

    SCRATCH.mkdir(parents=True, exist_ok=True)
    return resolve_toolchain()


def _marked_clip(toolchain: Any, output: Path, width: int = 320, height: int = 240) -> Path:
    proc = subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c=gray:s={width}x{height}:r=25:d=3",
            "-vf",
            "drawbox=x=100:y=80:w=80:h=60:color=red:t=fill",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            str(output),
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr[-300:]
    return output


def _frame_pixels(toolchain: Any, source: Path, frame: int = 50) -> list[tuple[int, int, int]]:
    proc = subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-i",
            str(source),
            "-vf",
            f"select=eq(n\\,{frame})",
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            str(SCRATCH / "frame.raw"),
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr[-300:]
    raw = (SCRATCH / "frame.raw").read_bytes()
    return [(raw[i], raw[i + 1], raw[i + 2]) for i in range(0, len(raw), 3)]


def _pixel_index(x: int, y: int, width: int = 320) -> int:
    return y * width + x


def test_delogo_rects_returns_one_filter_per_rect() -> None:
    rects = [
        {"id": "r1", "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2},
        {"id": "r2", "x": 0.5, "y": 0.5, "width": 0.2, "height": 0.2},
    ]
    filters = delogo_rects(rects, 320, 240)
    assert len(filters) == 2
    assert filters[0].startswith("delogo=x=32:y=24:w=64:h=48")


def test_delogo_rounds_to_even_pixels() -> None:
    rects = [{"id": "r1", "x": 0.31, "y": 0.31, "width": 0.21, "height": 0.21}]
    filters = delogo_rects(rects, 320, 240)
    assert "delogo=" in filters[0]


def test_delogo_rejects_tiny_rect() -> None:
    with pytest.raises(ValueError, match="pequeña"):
        delogo_rects([{"id": "r", "x": 0.5, "y": 0.5, "width": 0.01, "height": 0.01}], 320, 240)


def test_delogo_rejects_out_of_bounds() -> None:
    with pytest.raises(ValueError, match="excede"):
        delogo_rects([{"id": "r", "x": 0.9, "y": 0.9, "width": 0.3, "height": 0.3}], 320, 240)


def test_delogo_removes_red_mark_inside_region(toolchain: Any) -> None:
    source = _marked_clip(toolchain, SCRATCH / "marcado.mp4")
    rects = [{"id": "r1", "x": 100 / 320, "y": 80 / 240, "width": 80 / 320, "height": 60 / 240}]
    chain = ",".join(delogo_rects(rects, 320, 240))
    out = SCRATCH / "sin_marca.mp4"
    proc = subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-i",
            str(source),
            "-vf",
            chain,
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            str(out),
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr[-300:]
    assert out.is_file()

    pixels = _frame_pixels(toolchain, out)
    inside = pixels[_pixel_index(140, 110)]
    assert not (inside[0] > 150 and inside[1] < 100 and inside[2] < 100), f"rojo persistente: {inside}"


def test_outside_region_unchanged(toolchain: Any) -> None:
    source = _marked_clip(toolchain, SCRATCH / "marcado.mp4")
    before = _frame_pixels(toolchain, source)
    rects = [{"id": "r1", "x": 100 / 320, "y": 80 / 240, "width": 80 / 320, "height": 60 / 240}]
    out = SCRATCH / "sin_marca.mp4"
    subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-i",
            str(source),
            "-vf",
            ",".join(delogo_rects(rects, 320, 240)),
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            str(out),
        ],
        capture_output=True,
        timeout=120,
        check=False,
    )
    after = _frame_pixels(toolchain, out)
    before_corner = before[_pixel_index(20, 200)]
    after_corner = after[_pixel_index(20, 200)]
    for channel in range(3):
        assert abs(before_corner[channel] - after_corner[channel]) <= 12, (
            f"canal {channel}: {before_corner} vs {after_corner}"
        )


def test_multiple_marks_each_removed(toolchain: Any) -> None:
    source = SCRATCH / "dos_marcas.mp4"
    subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=gray:s=320x240:r=25:d=3",
            "-vf",
            "drawbox=x=40:y=40:w=60:h=40:color=red:t=fill,drawbox=x=200:y=150:w=60:h=40:color=red:t=fill",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            str(source),
        ],
        capture_output=True,
        timeout=120,
        check=False,
    )
    rects = [
        {"id": "r1", "x": 40 / 320, "y": 40 / 240, "width": 60 / 320, "height": 40 / 240},
        {"id": "r2", "x": 200 / 320, "y": 150 / 240, "width": 60 / 320, "height": 40 / 240},
    ]
    out = SCRATCH / "dos_sin_marca.mp4"
    proc = subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-i",
            str(source),
            "-vf",
            ",".join(delogo_rects(rects, 320, 240)),
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            str(out),
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr[-300:]
    pixels = _frame_pixels(toolchain, out)
    for point in [(70, 60), (230, 170)]:
        px = pixels[_pixel_index(*point)]
        assert not (px[0] > 150 and px[1] < 100 and px[2] < 100), f"rojo en {point}: {px}"


def test_delogo_applied_before_user_crop(toolchain: Any) -> None:
    source = _marked_clip(toolchain, SCRATCH / "marcado.mp4")
    rects = [{"id": "r1", "x": 100 / 320, "y": 80 / 240, "width": 80 / 320, "height": 60 / 240}]
    out = SCRATCH / "delogo_y_crop.mp4"
    proc = subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-i",
            str(source),
            "-vf",
            f"{','.join(delogo_rects(rects, 320, 240))},crop=160:240:160:0",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            str(out),
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr[-300:]
    assert out.is_file()


def test_vertical_video_delogo(toolchain: Any) -> None:
    source = SCRATCH / "vertical.mp4"
    subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=gray:s=240x320:r=25:d=2",
            "-vf",
            "drawbox=x=80:y=100:w=80:h=60:color=red:t=fill",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            str(source),
        ],
        capture_output=True,
        timeout=120,
        check=False,
    )
    rects = [{"id": "r1", "x": 80 / 240, "y": 100 / 320, "width": 80 / 240, "height": 60 / 320}]
    out = SCRATCH / "vertical_sin_marca.mp4"
    proc = subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-i",
            str(source),
            "-vf",
            ",".join(delogo_rects(rects, 240, 320)),
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            str(out),
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr[-300:]
    assert out.is_file()


def test_rect_touching_exact_edge_rejected() -> None:
    with pytest.raises(ValueError, match="borde"):
        delogo_rects([{"id": "r", "x": 240 / 320, "y": 160 / 240, "width": 80 / 320, "height": 80 / 240}], 320, 240)


def test_rect_near_edge_with_margin_works(toolchain: Any) -> None:
    source = _marked_clip(toolchain, SCRATCH / "marcado.mp4")
    rects = [{"id": "r1", "x": 240 / 320, "y": 160 / 240, "width": 79 / 320, "height": 79 / 240}]
    out = SCRATCH / "borde.mp4"
    proc = subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-i",
            str(source),
            "-vf",
            ",".join(delogo_rects(rects, 320, 240)),
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            str(out),
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr[-300:]
    assert out.is_file()


def test_no_mask_means_no_filter(toolchain: Any) -> None:
    assert delogo_rects([], 320, 240) == []
