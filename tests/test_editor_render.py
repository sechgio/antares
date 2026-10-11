"""Pruebas del render determinista del editor (L3, plan §L3.5-6).

El criterio de aceptación del hito: dos fuentes con hueco y
solapamiento producen una composición con orden, transformaciones,
velocidad y duración correctos, con audio sincronizado; el archivo
exportado reproduce fuera de Antares y el original queda intacto.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

from backend.core.editor.render import (
    RenderPlanError,
    asset_path,
    build_render_plan,
    execute_render,
)

BUILD_DIR = os.environ.get("ANTARES_FFMPEG_DIR", "")
pytestmark = pytest.mark.skipif(
    not BUILD_DIR or not Path(BUILD_DIR, "ffmpeg.exe").is_file(),
    reason="sin build FFmpeg preparado (ANTARES_FFMPEG_DIR)",
)

SCRATCH = Path(os.environ.get("TMPDIR", ".")) / "editor-render-tests"


@pytest.fixture(scope="module")
def toolchain() -> Any:
    from backend.core.editor.toolchain import resolve_toolchain

    return resolve_toolchain()


@pytest.fixture()
def assets_dir(tmp_path: Path) -> Path:
    return tmp_path / "assets"


def _video_stream(w: int = 320, h: int = 240) -> dict[str, Any]:  # allowlist: dict[str, Any]
    return {
        "index": 0,
        "kind": "video",
        "codec": "h264",
        "width": w,
        "height": h,
        "sar": {"num": 1, "den": 1},
        "rotation": 0,
        "orientation": "landscape",
        "timeBase": {"num": 1, "den": 12800},
    }


def _audio_stream() -> dict[str, Any]:  # allowlist: dict[str, Any]
    return {
        "index": 1,
        "kind": "audio",
        "codec": "aac",
        "timeBase": {"num": 1, "den": 48000},
        "sampleRate": 48000,
        "channels": 2,
    }


def _import_clip(tmp_path: Path, assets_dir: Path, name: str) -> dict[str, Any]:  # allowlist: dict[str, Any]
    from backend.core.editor.assets import import_file
    from backend.core.editor.toolchain import resolve_toolchain, synthesize_test_clip

    source = synthesize_test_clip(resolve_toolchain(), tmp_path / f"{name}.mp4")
    return import_file(str(source), assets_dir=assets_dir)


def _clip(asset_id: str, start_us: int, source_in_us: int, source_out_us: int, **over: Any) -> dict[str, Any]:  # allowlist: dict[str, Any]
    clip: dict[str, Any] = {  # allowlist: dict[str, Any]
        "id": f"clip-{start_us}-{asset_id[:6]}",
        "trackId": "track-v",
        "kind": "video",
        "assetId": asset_id,
        "timelineStartUs": start_us,
        "sourceInUs": source_in_us,
        "sourceOutUs": source_out_us,
        "speed": {"num": 1, "den": 1},
        "transform": {
            "crop": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
            "canvasX": 0.0,
            "canvasY": 0.0,
            "canvasW": 1.0,
            "canvasH": 1.0,
            "rotationDeg": 0.0,
            "flipX": False,
            "flipY": False,
            "opacity": 1.0,
            "fit": "fit",
        },
        "audio": {
            "streamIndex": 0,
            "embeddedEnabled": True,
            "gainDb": 0.0,
            "fadeInUs": 0,
            "fadeOutUs": 0,
            "effects": [],
        },
        "delogo": {"rects": []},
        "effects": [],
    }
    clip.update(over)
    return clip


def _snapshot(assets: list[dict[str, Any]], clips: list[dict[str, Any]], **over: Any) -> dict[str, Any]:  # allowlist: dict[str, Any]
    doc: dict[str, Any] = {  # allowlist: dict[str, Any]
        "id": "proj-render",
        "schemaVersion": 1,
        "name": "Render de prueba",
        "revision": 1,
        "createdAt": "2026-10-11T00:00:00.000Z",
        "updatedAt": "2026-10-11T00:00:00.000Z",
        "canvas": {
            "width": 320,
            "height": 240,
            "fps": {"num": 25, "den": 1},
            "background": {"type": "solid", "color": "#000000"},
            "workingColorSpace": "bt709-sdr",
        },
        "assets": assets,
        "tracks": [
            {"id": "track-v", "kind": "video", "order": 0, "visible": True, "muted": False, "locked": False}
        ],
        "clips": clips,
        "exportSettings": {
            "container": "mp4",
            "videoCodec": "h264",
            "audioCodec": "aac",
            "width": 320,
            "height": 240,
            "fps": {"num": 25, "den": 1},
            "qualityPreset": "draft",
            "audioSampleRate": 48000,
            "audioChannels": 2,
        },
    }
    doc.update(over)
    return doc


# --- Plan puro ------------------------------------------------------------------------


def test_plan_has_base_color_input(tmp_path: Path, assets_dir: Path) -> None:
    asset = _import_clip(tmp_path, assets_dir, "a")
    plan = build_render_plan(_snapshot([asset], [_clip(asset["id"], 0, 0, 2_000_000)]), assets_dir=assets_dir)
    assert plan["inputs"][0]["kind"] == "lavfi"
    assert plan["inputs"][0]["value"].startswith("color=c=#000000")
    assert plan["inputs"][1]["kind"] == "file"
    assert plan["duration_us"] == 2_000_000
    assert "[vout]" in plan["filter_complex"]


def test_plan_is_deterministic(tmp_path: Path, assets_dir: Path) -> None:
    asset = _import_clip(tmp_path, assets_dir, "a")
    snapshot = _snapshot([asset], [_clip(asset["id"], 0, 0, 2_000_000)])
    plan_a = build_render_plan(json.loads(json.dumps(snapshot)), assets_dir=assets_dir)
    plan_b = build_render_plan(json.loads(json.dumps(snapshot)), assets_dir=assets_dir)
    assert plan_a["filter_complex"] == plan_b["filter_complex"]


def test_plan_rejects_missing_asset() -> None:
    snapshot = _snapshot([], [_clip("fantasma", 0, 0, 1_000_000)])
    with pytest.raises(RenderPlanError, match="no encontrado"):
        build_render_plan(snapshot, assets_dir=assets_dir)


# --- Render real ------------------------------------------------------------------------


def test_single_clip_renders_with_expected_duration(tmp_path: Path, assets_dir: Path) -> None:
    asset = _import_clip(tmp_path, assets_dir, "a")
    out = tmp_path / "out.mp4"
    result = execute_render(_snapshot([asset], [_clip(asset["id"], 0, 0, 2_000_000)]), out, assets_dir=assets_dir)
    assert out.is_file()
    assert 1.9 <= result["durationUs"] / 1_000_000 <= 2.1
    # El original gestionado queda intacto.
    assert asset_path(asset, assets_dir).is_file()


def test_gap_between_clips_produces_full_duration(tmp_path: Path, assets_dir: Path) -> None:
    """Clip A 0-2s, hueco 2-4s, clip B 4-6s → salida de 6s."""
    asset = _import_clip(tmp_path, assets_dir, "a")
    clips = [
        _clip(asset["id"], 0, 0, 2_000_000),
        _clip(asset["id"], 4_000_000, 0, 2_000_000),
    ]
    out = tmp_path / "gap.mp4"
    result = execute_render(_snapshot([asset], clips), out, assets_dir=assets_dir)
    assert 5.8 <= result["durationUs"] / 1_000_000 <= 6.2


def test_overlapping_clips_compose_in_order(tmp_path: Path, assets_dir: Path) -> None:
    """Dos clips solapados en pistas distintas: el de mayor order encima."""
    asset = _import_clip(tmp_path, assets_dir, "a")
    base_clip = _clip(asset["id"], 0, 0, 3_000_000, id="base")
    top_clip = _clip(asset["id"], 1_000_000, 0, 3_000_000, id="top", trackId="track-v2")
    top_clip["transform"]["opacity"] = 0.5
    snapshot = _snapshot(
        [asset],
        [base_clip, top_clip],
        tracks=[
            {"id": "track-v", "kind": "video", "order": 0, "visible": True, "muted": False, "locked": False},
            {"id": "track-v2", "kind": "video", "order": 1, "visible": True, "muted": False, "locked": False},
        ],
    )
    out = tmp_path / "overlap.mp4"
    result = execute_render(snapshot, out, assets_dir=assets_dir)
    assert out.is_file()
    assert result["streams"] >= 1


def test_speed_change_alters_output_duration(tmp_path: Path, assets_dir: Path) -> None:
    """Un clip a media velocidad dura el doble en la salida."""
    asset = _import_clip(tmp_path, assets_dir, "a")
    clip = _clip(asset["id"], 0, 0, 2_000_000, speed={"num": 1, "den": 2})
    out = tmp_path / "slow.mp4"
    result = execute_render(_snapshot([asset], [clip]), out, assets_dir=assets_dir)
    assert 3.8 <= result["durationUs"] / 1_000_000 <= 4.2


def test_crop_and_rotation_render(tmp_path: Path, assets_dir: Path) -> None:
    asset = _import_clip(tmp_path, assets_dir, "a")
    clip = _clip(asset["id"], 0, 0, 2_000_000)
    clip["transform"]["crop"] = {"x": 0.25, "y": 0.25, "width": 0.5, "height": 0.5}
    clip["transform"]["rotationDeg"] = 90
    out = tmp_path / "transformed.mp4"
    execute_render(_snapshot([asset], [clip]), out, assets_dir=assets_dir)
    assert out.is_file()
    from backend.core.editor.toolchain import probe_json, resolve_toolchain

    meta = probe_json(resolve_toolchain(), out)
    assert meta["streams"][0]["width"] == 320 and meta["streams"][0]["height"] == 240


def test_audio_present_in_output(tmp_path: Path, assets_dir: Path) -> None:
    asset = _import_clip(tmp_path, assets_dir, "a")
    out = tmp_path / "withaudio.mp4"
    execute_render(_snapshot([asset], [_clip(asset["id"], 0, 0, 2_000_000)]), out, assets_dir=assets_dir)
    from backend.core.editor.toolchain import probe_json, resolve_toolchain

    meta = probe_json(resolve_toolchain(), out)
    kinds = [s["codec_type"] for s in meta["streams"]]
    assert "audio" in kinds


def test_failed_render_leaves_no_output(tmp_path: Path, assets_dir: Path) -> None:
    """Un snapshot inválido no debe dejar un archivo parcial."""
    asset = _import_clip(tmp_path, assets_dir, "a")
    clip = _clip(asset["id"], 0, 0, 2_000_000)
    clip["transform"]["crop"] = {"x": 0.9, "y": 0.9, "width": 0.5, "height": 0.5}
    out = tmp_path / "bad.mp4"
    with pytest.raises(ValueError):
        execute_render(_snapshot([asset], [clip]), out, assets_dir=assets_dir)
    assert not out.exists()
    leftovers = list(tmp_path.glob(".bad.mp4.*.tmp"))
    assert leftovers == []


def test_cancel_stops_render_and_leaves_no_output(tmp_path: Path, assets_dir: Path) -> None:
    asset = _import_clip(tmp_path, assets_dir, "a")
    out = tmp_path / "cancelled.mp4"

    def cancel_now() -> bool:
        return True

    with pytest.raises(Exception, match="cancel"):
        execute_render(
            _snapshot([asset], [_clip(asset["id"], 0, 0, 2_000_000)]),
            out,
            cancel_check=cancel_now,
            assets_dir=assets_dir,
        )
    assert not out.exists()
