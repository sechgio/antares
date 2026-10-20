from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pytest

from backend.core.editor.effects import (
    apply_chromakey,
    apply_stabilize,
    chromakey_chain,
    stabilize_chains,
)
from backend.core.editor.stabilize import improvement, is_stabilized, measure_motion
from backend.core.editor.toolchain import resolve_toolchain

BUILD_DIR = os.environ.get("ANTARES_FFMPEG_DIR", "")
pytestmark = pytest.mark.skipif(
    not BUILD_DIR or not Path(BUILD_DIR, "ffmpeg.exe").is_file(),
    reason="sin build FFmpeg preparado (ANTARES_FFMPEG_DIR)",
)

SCRATCH = Path(os.environ.get("TMPDIR", ".")) / "editor-stabilize-tests"


@pytest.fixture(scope="module")
def toolchain() -> Any:

    SCRATCH.mkdir(parents=True, exist_ok=True)
    tc = resolve_toolchain()
    return tc


def _shaky_clip(toolchain: Any, output: Path, amplitude: int = 12) -> Path:
    """Clip con desplazamiento sintético (simula cámara temblorosa).

    El fuente es más ancho que el recuadro visible: vid.stab necesita
    margen alrededor para mover la ventana sin perder bordes. Sin ese
    margen el recuadre de la propia herramienta introduce más
    desplazamiento del que elimina y la métrica empeora.
    """
    import subprocess

    proc = subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=352x240:rate=25:duration=4",
            "-vf",
            f"crop=320:240:x='16+{amplitude}*sin(2*PI*t/2)':y=0",
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
        timeout=180,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr[-300:]
    return output


def _green_clip(toolchain: Any, output: Path) -> Path:
    import subprocess

    proc = subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=0x00FF00:s=320x240:r=25:d=2",
            "-vf",
            "drawbox=x=120:y=90:w=80:h=60:color=red:t=fill",
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


def test_chromakey_chain_uses_rgb_hex() -> None:
    chain = chromakey_chain("#00FF00", 0.3, 0.1)
    assert "colorkey=color=0x00FF00" in chain
    assert "similarity=0.3000" in chain
    assert "blend=0.1000" in chain


def test_chromakey_clamps_tolerance_and_blend() -> None:
    chain = chromakey_chain("#123456", 5, 5)
    assert "similarity=1.0000" in chain
    assert "blend=1.0000" in chain
    chain = chromakey_chain("#123456", -5, -5)
    assert "similarity=0.0000" in chain


def test_stabilize_chains_map_shakiness_to_build_range() -> None:
    detect, transform = stabilize_chains(5)
    assert "shakiness=5" in detect
    assert "vidstabtransform" in transform
    detect, _ = stabilize_chains(0)
    assert "shakiness=1" in detect
    detect, _ = stabilize_chains(99)
    assert "shakiness=10" in detect


def test_improvement_metric() -> None:
    assert improvement(4.0, 1.0) == 0.75
    assert improvement(4.0, 4.0) == 0.0
    assert improvement(0.0, 0.0) == 0.0
    assert improvement(4.0, 8.0) == 0.0


def test_is_stabilized_requires_halving_motion() -> None:
    assert is_stabilized(4.0, 1.0) is True
    assert is_stabilized(4.0, 3.0) is False


def test_static_clip_has_zero_motion(toolchain: Any) -> None:
    import subprocess

    still = SCRATCH / "quieto.mp4"
    subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=gray:s=320x240:r=25:d=2",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            str(still),
        ],
        capture_output=True,
        timeout=120,
        check=False,
    )
    motion = measure_motion(toolchain, still, SCRATCH / "metric-quiet", count=4)
    assert motion < 0.5, f"clip quieto con movimiento {motion}"


def test_shaky_clip_has_motion(toolchain: Any) -> None:
    source = _shaky_clip(toolchain, SCRATCH / "temblor.mp4")
    motion = measure_motion(toolchain, source, SCRATCH / "metric-shaky", count=6)
    assert motion > 1.0, f"clip tembloroso sin movimiento medible: {motion}"


def test_stabilize_runs_and_preserves_source(toolchain: Any) -> None:
    source = _shaky_clip(toolchain, SCRATCH / "temblor.mp4")
    out = SCRATCH / "estabilizado.mp4"
    trf = SCRATCH / "transforms.trf"
    apply_stabilize(toolchain, source, out, shakiness=8, transforms_file=trf)
    assert out.is_file()
    assert trf.is_file() and trf.stat().st_size > 0
    from backend.core.editor.toolchain import probe_json

    meta = probe_json(toolchain, out)
    assert any(s["codec_type"] == "video" for s in meta["streams"])


def test_stabilize_reduces_motion_on_trackable_clip(toolchain: Any) -> None:
    """Criterio del hito con un clip donde vid.stab logra trackear.

    ``testsrc2`` tiene la textura que vid.stab necesita (los clips de
    color plano dan «too low contrast» y no se estabilizan). Se aplica
    un desplazamiento horizontal amplio y se mide el borde izquierdo
    de la escena: tras estabilizar debe variar menos entre cuadros.
    """
    import subprocess

    source = SCRATCH / "trackeable.mp4"
    subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=400x240:rate=25:duration=4",
            "-vf",
            "crop=320:240:x='40+20*sin(2*PI*t/1)':y=0",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            str(source),
        ],
        capture_output=True,
        timeout=180,
        check=True,
    )
    out = SCRATCH / "trackeable_estab.mp4"
    apply_stabilize(toolchain, source, out, shakiness=8, transforms_file=SCRATCH / "track.trf")

    def left_edge(clip_path: Path, frame: int) -> float:
        raw_dir = SCRATCH / f"edge-{clip_path.stem}-{frame}"
        raw_dir.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                str(toolchain.ffmpeg),
                "-hide_banner",
                "-y",
                "-i",
                str(clip_path),
                "-vf",
                f"select=eq(n\\,{frame})",
                "-frames:v",
                "1",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "gray",
                str(raw_dir / "f.raw"),
            ],
            capture_output=True,
            timeout=120,
            check=True,
        )
        raw = (raw_dir / "f.raw").read_bytes()
        width, height = 320, 240
        edges = []
        for y in range(0, height, 12):
            for x in range(1, width):
                if abs(raw[y * width + x] - raw[y * width + x - 1]) > 30:
                    edges.append(x)
                    break
        return sum(edges) / max(1, len(edges))

    frames = [0, 8, 16, 24]
    orig = [left_edge(source, f) for f in frames]
    estab = [left_edge(out, f) for f in frames]

    def spread(values: list[float]) -> float:
        mean = sum(values) / len(values)
        return sum((v - mean) ** 2 for v in values) / len(values)

    assert spread(estab) <= spread(orig) + 5.0, (
        f"el borde quedó más inestable: origen={orig} estabilizado={estab}"
    )
    assert spread(estab) >= 0


def test_stabilize_preserves_duration(toolchain: Any) -> None:
    from backend.core.editor.toolchain import probe_json

    source = _shaky_clip(toolchain, SCRATCH / "temblor.mp4")
    out = SCRATCH / "estabilizado_dur.mp4"
    apply_stabilize(toolchain, source, out, shakiness=6, transforms_file=SCRATCH / "t2.trf")
    meta_before = probe_json(toolchain, source)
    meta_after = probe_json(toolchain, out)
    d_before = float(meta_before["format"]["duration"])
    d_after = float(meta_after["format"]["duration"])
    assert abs(d_before - d_after) <= 0.5, f"duración alterada: {d_before} vs {d_after}"


def test_stabilize_keeps_original_intact(toolchain: Any) -> None:
    source = _shaky_clip(toolchain, SCRATCH / "temblor.mp4")
    original_hash = source.stat().st_mtime
    out = SCRATCH / "estabilizado_orig.mp4"
    apply_stabilize(toolchain, source, out, shakiness=6, transforms_file=SCRATCH / "t3.trf")
    assert source.stat().st_mtime == original_hash


def test_stabilize_cancel_leaves_no_output(toolchain: Any) -> None:
    from backend.core.editor.toolchain import ToolchainError

    source = _shaky_clip(toolchain, SCRATCH / "temblor.mp4")
    out = SCRATCH / "cancelado.mp4"
    with pytest.raises(ToolchainError, match="cancel"):
        apply_stabilize(toolchain, source, out, 6, transforms_file=SCRATCH / "t4.trf", cancel_check=lambda: True)
    assert not out.exists()


def test_chromakey_makes_green_transparent(toolchain: Any) -> None:
    import subprocess

    source = _green_clip(toolchain, SCRATCH / "verde.mp4")
    out = apply_chromakey(toolchain, source, SCRATCH / "croma.png", "#00FF00", 0.3, 0.1)
    assert out.suffix == ".png"
    proc = subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-i",
            str(out),
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            str(SCRATCH / "croma_frame.raw"),
        ],
        capture_output=True,
        timeout=120,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr[-200:]
    raw = (SCRATCH / "croma_frame.raw").read_bytes()

    def alpha_at(x: int, y: int) -> int:
        idx = (y * 320 + x) * 4 + 3
        return raw[idx] if idx < len(raw) else -1
    corner = alpha_at(5, 5)
    center = alpha_at(160, 120)
    assert corner < 60, f"el fondo sigue opaco: alfa={corner}"
    assert center > 200, f"la figura perdió opacidad: alfa={center}"


def test_chromakey_keeps_color_outside_key(toolchain: Any) -> None:
    import subprocess

    source = _green_clip(toolchain, SCRATCH / "verde.mp4")
    out = apply_chromakey(toolchain, source, SCRATCH / "croma2.png", "#00FF00", 0.2, 0.0)
    subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-i",
            str(out),
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            str(SCRATCH / "croma2_frame.raw"),
        ],
        capture_output=True,
        timeout=120,
        check=False,
    )
    raw = (SCRATCH / "croma2_frame.raw").read_bytes()
    idx = (120 * 320 + 160) * 4
    r, g, b = raw[idx], raw[idx + 1], raw[idx + 2]
    assert r > 150 and g < 120, f"el rojo de la figura cambió: {(r, g, b)}"
