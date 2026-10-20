from __future__ import annotations

import math
from typing import Any

import pytest

from backend.core.editor.models import (
    SCHEMA_VERSION,
    clip_duration_us,
    normalize_document,
    validate_document,
)

VIDEO_STREAM: dict[str, Any] = {
    "index": 0,
    "kind": "video",
    "codec": "h264",
    "width": 320,
    "height": 240,
    "sar": {"num": 1, "den": 1},
    "rotation": 0,
    "orientation": "landscape",
    "timeBase": {"num": 1, "den": 12800},
}

AUDIO_STREAM: dict[str, Any] = {
    "index": 1,
    "kind": "audio",
    "codec": "aac",
    "timeBase": {"num": 1, "den": 48000},
    "sampleRate": 48000,
    "channels": 2,
}

IDENTITY_TRANSFORM: dict[str, Any] = {
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
}

SILENT_AUDIO: dict[str, Any] = {
    "streamIndex": 0,
    "embeddedEnabled": True,
    "gainDb": 0.0,
    "fadeInUs": 0,
    "fadeOutUs": 0,
    "effects": [],
}


def _asset(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "asset-1",
        "type": "video",
        "displayName": "clip.mp4",
        "byteSize": 1024,
        "sha256": "a" * 64,
        "durationUs": 10_000_000,
        "streams": [VIDEO_STREAM, AUDIO_STREAM],
    }
    base.update(overrides)
    return base


def _clip(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "clip-1",
        "trackId": "track-v",
        "kind": "video",
        "assetId": "asset-1",
        "timelineStartUs": 0,
        "sourceInUs": 0,
        "sourceOutUs": 5_000_000,
        "speed": {"num": 1, "den": 1},
        "transform": dict(IDENTITY_TRANSFORM),
        "audio": dict(SILENT_AUDIO),
        "delogo": {"rects": []},
        "effects": [],
    }
    base.update(overrides)
    return base


def _document(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "proj-1",
        "schemaVersion": SCHEMA_VERSION,
        "name": "Proyecto de prueba",
        "revision": 1,
        "createdAt": "2026-10-11T00:00:00.000Z",
        "updatedAt": "2026-10-11T00:00:00.000Z",
        "canvas": {
            "width": 640,
            "height": 360,
            "fps": {"num": 25, "den": 1},
            "background": {"type": "solid", "color": "#000000"},
            "workingColorSpace": "bt709-sdr",
        },
        "assets": [_asset()],
        "tracks": [
            {
                "id": "track-v",
                "kind": "video",
                "order": 0,
                "visible": True,
                "muted": False,
                "locked": False,
            }
        ],
        "clips": [_clip()],
        "exportSettings": {
            "container": "mp4",
            "videoCodec": "h264",
            "audioCodec": "aac",
            "width": 640,
            "height": 360,
            "fps": {"num": 25, "den": 1},
            "qualityPreset": "balanced",
            "audioSampleRate": 48000,
            "audioChannels": 2,
        },
    }
    base.update(overrides)
    return base


def test_minimal_document_validates() -> None:
    validate_document(_document())


def test_document_rejects_unknown_fields() -> None:
    doc = _document()
    doc["extraCampo"] = 1
    with pytest.raises(ValueError):
        validate_document(doc)


def test_document_rejects_future_schema_version() -> None:
    doc = _document(schemaVersion=SCHEMA_VERSION + 1)
    with pytest.raises(ValueError, match="incompatible"):
        validate_document(doc)


def test_duration_with_speed_half_is_doubled() -> None:
    clip = _clip(speed={"num": 1, "den": 2})
    assert clip_duration_us(clip) == 10_000_000


def test_duration_with_speed_double_is_halved() -> None:
    clip = _clip(speed={"num": 2, "den": 1})
    assert clip_duration_us(clip) == 2_500_000


def test_duration_with_ntsc_speed_rounds_half_up() -> None:
    clip = _clip(sourceOutUs=3_000_000, speed={"num": 3, "den": 2})
    assert clip_duration_us(clip) == 2_000_000
    clip = _clip(sourceInUs=0, sourceOutUs=2_000_000, speed={"num": 2, "den": 3})
    assert clip_duration_us(clip) == 3_000_000


def test_speed_zero_den_rejected() -> None:
    doc = _document()
    doc["clips"][0]["speed"] = {"num": 1, "den": 0}
    with pytest.raises(ValueError):
        validate_document(doc)


def test_split_preserves_shared_boundary() -> None:
    original = _clip(sourceInUs=0, sourceOutUs=5_000_000)
    total = clip_duration_us(original)
    left = _clip(sourceInUs=0, sourceOutUs=2_000_000)
    right = _clip(sourceInUs=2_000_000, sourceOutUs=5_000_000)
    assert clip_duration_us(left) + clip_duration_us(right) == total


def test_source_out_must_exceed_source_in() -> None:
    clip = _clip(sourceInUs=5_000_000, sourceOutUs=5_000_000)
    with pytest.raises(ValueError):
        validate_document(_document(clips=[clip]))


def test_negative_timeline_start_rejected() -> None:
    clip = _clip(timelineStartUs=-1)
    with pytest.raises(ValueError):
        validate_document(_document(clips=[clip]))


def test_delogo_rects_stay_in_oriented_source_space() -> None:
    clip = _clip(
        delogo={
            "rects": [
                {"id": "r1", "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2},
                {"id": "r2", "x": 0.5, "y": 0.25, "width": 0.25, "height": 0.5},
            ]
        }
    )
    validate_document(_document(clips=[clip]))


def test_delogo_rejects_zero_width_rect() -> None:
    clip = _clip(
        delogo={"rects": [{"id": "r1", "x": 0.1, "y": 0.1, "width": 0.0, "height": 0.2}]}
    )
    with pytest.raises(ValueError):
        validate_document(_document(clips=[clip]))


def test_delogo_rejects_negative_coordinates() -> None:
    clip = _clip(
        delogo={"rects": [{"id": "r1", "x": -0.1, "y": 0.1, "width": 0.2, "height": 0.2}]}
    )
    with pytest.raises(ValueError):
        validate_document(_document(clips=[clip]))


def test_crop_edges_must_not_exceed_one() -> None:
    clip = _clip()
    clip["transform"]["crop"] = {"x": 0.8, "y": 0.0, "width": 0.5, "height": 0.5}
    with pytest.raises(ValueError, match="crop"):
        validate_document(_document(clips=[clip]))


def test_portrait_asset_with_rotation_metadata_validates() -> None:
    stream = dict(VIDEO_STREAM, width=240, height=320, rotation=90, orientation="portrait")
    asset = _asset(streams=[stream, AUDIO_STREAM])
    validate_document(_document(assets=[asset]))


def test_asset_requires_at_least_one_stream() -> None:
    with pytest.raises(ValueError):
        validate_document(_document(assets=[_asset(streams=[])]))


def test_video_only_asset_validates_and_allows_silent_clip() -> None:
    asset = _asset(streams=[VIDEO_STREAM])
    clip = _clip()
    validate_document(_document(assets=[asset], clips=[clip]))


def test_repeated_clip_total_duration_is_sum() -> None:
    once = _clip(sourceInUs=0, sourceOutUs=2_000_000)
    copies = []
    for i in range(3):
        copies.append(_clip(id=f"clip-{i}", timelineStartUs=i * 2_000_000, sourceInUs=0, sourceOutUs=2_000_000))
    assert sum(clip_duration_us(c) for c in copies) == 3 * clip_duration_us(once)
    validate_document(_document(clips=copies))


def test_normalize_bumps_revision_and_touches_updated_at() -> None:
    doc = normalize_document(_document())
    assert doc["revision"] == 2
    assert doc["updatedAt"] != "2026-10-11T00:00:00.000Z"


def test_normalize_does_not_double_bump_same_revision() -> None:
    doc = normalize_document(_document())
    doc2 = normalize_document(doc, expected_revision=2)
    assert doc2["revision"] == 3


def test_normalize_rejects_stale_expected_revision() -> None:
    with pytest.raises(ValueError, match="revision"):
        normalize_document(_document(), expected_revision=5)


def test_ntsc_fps_rational_is_valid_and_preserved() -> None:
    doc = _document()
    doc["canvas"]["fps"] = {"num": 30000, "den": 1001}
    validate_document(doc)
    assert doc["canvas"]["fps"]["num"] == 30000


def test_fps_round_trip_is_stable() -> None:
    us = 1_500_000
    num, den = 30000, 1001
    frames = math.floor((us * num) / (den * 1_000_000) + 0.5)
    assert frames == 45
