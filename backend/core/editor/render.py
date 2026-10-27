from __future__ import annotations

import time
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from backend.core.editor import filters
from backend.core.editor.models import clip_duration_us, validate_document
from backend.core.editor.toolchain import (
    ToolchainError,
    probe_json,
    resolve_toolchain,
)
from backend.utils.paths import user_data_path

MAX_CLIPS_IN_GRAPH = 64


class RenderPlanError(ValueError):
    pass


def build_render_plan(snapshot: dict[str, Any], *, assets_dir: Path | None = None) -> dict[str, Any]:  # allowlist: dict[str, Any]
    doc = validate_document(snapshot)
    canvas = doc["canvas"]
    export = doc["exportSettings"]
    canvas_w = int(canvas["width"])
    canvas_h = int(canvas["height"])
    fps_num = int(export["fps"]["num"])
    fps_den = int(export["fps"]["den"])

    assets_by_id = {asset["id"]: asset for asset in doc["assets"]}
    tracks_by_id = {track["id"]: track for track in doc["tracks"]}

    visual_clips = [c for c in doc["clips"] if c["kind"] in ("video", "image", "text")]
    audio_clips = [c for c in doc["clips"] if c["kind"] in ("video", "audio")]
    if len(visual_clips) > MAX_CLIPS_IN_GRAPH:
        raise RenderPlanError(
            f"el proyecto tiene {len(visual_clips)} clips visuales; el máximo por composición es {MAX_CLIPS_IN_GRAPH}"
        )

    def track_order(clip: dict[str, Any]) -> int:  # allowlist: dict[str, Any]
        track = tracks_by_id.get(clip["trackId"])
        return int(track["order"]) if track else 0

    visual_clips.sort(key=lambda c: (track_order(c), int(c["timelineStartUs"])))
    audio_clips.sort(key=lambda c: int(c["timelineStartUs"]))

    timeline_end_us = 0
    for clip in doc["clips"]:
        end = int(clip["timelineStartUs"]) + clip_duration_us(clip)
        timeline_end_us = max(timeline_end_us, end)
    if timeline_end_us <= 0:
        timeline_end_us = 1_000_000

    inputs: list[dict[str, str]] = []
    bg_color = canvas["background"].get("color", "#000000") if canvas["background"]["type"] == "solid" else "#000000"
    inputs.append({"kind": "lavfi", "value": f"color=c={bg_color}:s={canvas_w}x{canvas_h}:r={fps_num}/{fps_den}:d={_s(timeline_end_us)}"})

    input_index_of_asset: dict[str, int] = {}
    text_inputs: dict[str, int] = {}
    text_cache = assets_dir.parent / "cache" / "text" if assets_dir is not None else None
    for clip in [*visual_clips, *audio_clips]:
        asset_id = str(clip.get("assetId", ""))
        if clip["kind"] == "text" and not asset_id:
            from backend.core.editor.text import render_text_bitmap

            bitmap = render_text_bitmap(clip, canvas_w, canvas_h, cache_dir=text_cache)
            if clip["id"] not in text_inputs:
                text_inputs[clip["id"]] = len(inputs)
                inputs.append({"kind": "file", "value": str(bitmap)})
            continue
        asset = assets_by_id.get(asset_id)
        if asset is None:
            raise RenderPlanError(f"clip {clip['id']}: asset {asset_id} no encontrado")
        if asset_id not in input_index_of_asset:
            input_index_of_asset[asset_id] = len(inputs)
            inputs.append({"kind": "file", "value": str(asset_path(asset, assets_dir))})

    chains: list[str] = []
    labels_v: list[str] = []
    labels_a: list[str] = []
    for chain_index, clip in enumerate(visual_clips):
        if clip["kind"] == "text" and not str(clip.get("assetId", "")):
            input_index = text_inputs[clip["id"]]
        else:
            asset = assets_by_id[str(clip["assetId"])]
            input_index = input_index_of_asset[str(asset["id"])]
        chain, label = _visual_chain(clip, input_index, assets_by_id, canvas_w, canvas_h, chain_index)
        chains.append(chain)
        labels_v.append(label)
    for chain_index, clip in enumerate(audio_clips):
        asset = assets_by_id[str(clip["assetId"])]
        input_index = input_index_of_asset[str(asset["id"])]
        chain, label = _audio_chain(clip, input_index, assets_by_id, chain_index, timeline_end_us)
        chains.append(chain)
        labels_a.append(label)

    compose = ""
    if labels_v:
        current = "base"
        parts = ["[0:v]format=yuv420p[base]"]
        for i, label in enumerate(labels_v):
            out = "vout" if i == len(labels_v) - 1 else f"comp{i}"
            parts.append(f"[{current}][{label}]overlay=0:0:enable='between(t,0,{_s(timeline_end_us)})'[{out}]")
            current = out
        compose = ";".join(parts)
    else:
        compose = f"[0:v]format=yuv420p,trim=duration={_s(timeline_end_us)},setpts=PTS-STARTPTS[vout]"

    audio_compose = ""
    if labels_a:
        mix_inputs = "".join(f"[{label}]" for label in labels_a)
        audio_compose = f"{mix_inputs}amix=inputs={len(labels_a)}:duration=longest:normalize=0[aout]"
    else:
        sample_rate = int(export["audioSampleRate"])
        channels = int(export["audioChannels"])
        audio_compose = (
            f"anullsrc=channel_layout={'stereo' if channels == 2 else 'mono'}"
            f":sample_rate={sample_rate}:d={_s(timeline_end_us)}[aout]"
        )

    graph = ";".join([*chains, compose, audio_compose])

    return {
        "inputs": inputs,
        "filter_complex": graph,
        "duration_us": timeline_end_us,
        "args": _output_args(export),
        "map": ["[vout]", "[aout]"],
    }


def _s(us: float) -> str:
    return filters._num(us / 1_000_000)


def _visual_chain(
    clip: dict[str, Any],  # allowlist: dict[str, Any]
    input_index: int,
    assets_by_id: dict[str, dict[str, Any]],  # allowlist: dict[str, Any]
    canvas_w: int,
    canvas_h: int,
    chain_index: int,
) -> tuple[str, str]:
    is_text = clip["kind"] == "text" and not str(clip.get("assetId", ""))
    if not is_text:
        asset = assets_by_id.get(str(clip.get("assetId", "")))
        if asset is None:
            raise RenderPlanError(f"clip {clip['id']}: asset {clip.get('assetId')} no encontrado")

    parts: list[str] = []
    if is_text:
        duration_s = _s(clip_duration_us(clip))
        parts.append(f"loop=loop=-1:size=1,trim=duration={duration_s},setpts=PTS-STARTPTS")
    else:
        parts.append(filters.trim_video(int(clip["sourceInUs"]), int(clip["sourceOutUs"])))
    speed = filters.speed(int(clip["speed"]["num"]), int(clip["speed"]["den"]), has_audio=False)
    if speed:
        parts.append(speed)
    shift = filters.setpts_shift(int(clip["timelineStartUs"]))
    if shift:
        parts.append(shift)

    transform = clip["transform"]
    src_w, src_h = (canvas_w, canvas_h) if is_text or asset is None else _asset_dimensions(asset)
    crop = filters.crop(
        float(transform["crop"]["x"]),
        float(transform["crop"]["y"]),
        float(transform["crop"]["width"]),
        float(transform["crop"]["height"]),
        src_w,
        src_h,
    )
    if crop:
        parts.append(crop)
    rot = filters.rotate(float(transform["rotationDeg"]))
    if rot:
        parts.append(rot)
    fl = filters.flip(bool(transform["flipX"]), bool(transform["flipY"]))
    if fl:
        parts.append(fl)
    for delogo_filter in filters.delogo_rects(clip["delogo"]["rects"], src_w, src_h):
        parts.append(delogo_filter)
    parts.append(filters.fit_canvas(src_w, src_h, canvas_w, canvas_h, str(transform["fit"])))
    op = filters.opacity(float(transform["opacity"]))
    if op:
        parts.append(op)
    if not is_text:
        parts.append("format=yuva420p")

    label = f"v{chain_index}"
    chain = f"[{input_index}:v]{','.join(parts)}[{label}]"
    return chain, label


def _audio_chain(
    clip: dict[str, Any],  # allowlist: dict[str, Any]
    input_index: int,
    assets_by_id: dict[str, dict[str, Any]],  # allowlist: dict[str, Any]
    chain_index: int,
    timeline_end_us: int,
) -> tuple[str, str]:
    asset = assets_by_id.get(str(clip.get("assetId", "")))
    if asset is None:
        raise RenderPlanError(f"clip {clip['id']}: asset {clip.get('assetId')} no encontrado")
    audio_streams = [s for s in asset["streams"] if s["kind"] == "audio"]
    if not audio_streams:
        raise RenderPlanError(f"clip {clip['id']}: el asset no tiene audio")
    sample_rate = int(audio_streams[0].get("sampleRate", 48000) or 48000)

    audio = clip["audio"]
    if not bool(audio["embeddedEnabled"]):
        raise RenderPlanError(f"clip {clip['id']}: audio embebido desactivado sin pista independiente")
    parts = [f"atrim=start={_s(int(clip['sourceInUs']))}:end={_s(int(clip['sourceOutUs']) + 1e-6)}"]
    tempo = filters.audio_tempo(int(clip["speed"]["num"]), int(clip["speed"]["den"]))
    if tempo:
        parts.append(tempo)
    parts.append("asetpts=PTS-STARTPTS")
    gain = filters.audio_gain(float(audio["gainDb"]))
    if gain:
        parts.append(gain)
    duration_us = clip_duration_us(clip)
    fades = filters.audio_fades(int(audio["fadeInUs"]), int(audio["fadeOutUs"]), duration_us)
    if fades:
        parts.append(fades)
    delay = filters.delay_audio(int(clip["timelineStartUs"]))
    if delay:
        parts.append(delay)
    parts.append(f"aresample={sample_rate}")
    # Rellenar solo hasta el final del timeline: apad sin whole_dur
    # alargaría el audio indefinidamente y el render no terminaría.
    parts.append(f"apad=whole_dur={_s(timeline_end_us)}")

    label = f"a{chain_index}"
    chain = f"[{input_index}:a]{','.join(parts)}[{label}]"
    return chain, label


def _asset_dimensions(asset: dict[str, Any]) -> tuple[int, int]:  # allowlist: dict[str, Any]
    for stream in asset["streams"]:
        if stream["kind"] == "video":
            return int(stream["width"]), int(stream["height"])
    return 1280, 720


def asset_path(asset: dict[str, Any], assets_dir: Path | None = None) -> Path:  # allowlist: dict[str, Any]
    from backend.core.editor.assets import ALLOWED_SUFFIXES

    base = assets_dir if assets_dir is not None else user_data_path("editor") / "assets"
    asset_id = str(asset["id"])
    for suffix in ALLOWED_SUFFIXES:
        candidate = base / f"{asset_id}{suffix}"
        if candidate.is_file():
            return candidate
    raise RenderPlanError(f"el archivo del asset {asset_id} no está en el almacén gestionado")


def _output_args(export: dict[str, Any]) -> list[str]:  # allowlist: dict[str, Any]
    container = str(export["container"])
    video_codec = str(export["videoCodec"])
    audio_codec = str(export["audioCodec"])
    fps = f"{export['fps']['num']}/{export['fps']['den']}"
    preset = str(export["qualityPreset"])
    crf = {"draft": "30", "balanced": "23", "high": "18"}[preset]
    args = ["-map", "[vout]", "-map", "[aout]", "-r", fps]
    if video_codec == "h264":
        args += ["-c:v", "libx264", "-preset", "medium", "-crf", crf, "-pix_fmt", "yuv420p"]
    elif video_codec == "vp9":
        args += ["-c:v", "libvpx-vp9", "-crf", crf, "-b:v", "0"]
    if audio_codec == "aac":
        args += ["-c:a", "aac", "-b:a", "192k"]
    elif audio_codec == "opus":
        args += ["-c:a", "libopus", "-b:a", "160k"]
    if container == "mp4":
        args += ["-movflags", "+faststart"]
    args += ["-f", container]
    return args


def execute_render(
    snapshot: dict[str, Any],  # allowlist: dict[str, Any]
    output: Path,
    *,
    cancel_check: Callable[[], bool] | None = None,
    assets_dir: Path | None = None,
) -> dict[str, Any]:  # allowlist: dict[str, Any]
    import subprocess

    if cancel_check and cancel_check():
        raise ToolchainError("render cancelado")
    plan = build_render_plan(snapshot, assets_dir=assets_dir)
    toolchain = resolve_toolchain()
    output.parent.mkdir(parents=True, exist_ok=True)
    tmp = output.with_name(f".{output.name}.{uuid.uuid4().hex[:8]}.tmp")

    cmd = [str(toolchain.ffmpeg), "-hide_banner", "-y", "-nostdin"]
    for source in plan["inputs"]:
        if source["kind"] == "lavfi":
            cmd += ["-f", "lavfi", "-i", source["value"]]
        else:
            cmd += ["-i", source["value"]]
    cmd += ["-filter_complex", plan["filter_complex"], *plan["args"], str(tmp)]

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    deadline = time.monotonic() + 1800
    try:
        while True:
            if cancel_check and cancel_check():
                raise ToolchainError("render cancelado")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired(cmd, 1800)
            try:
                _, stderr = proc.communicate(timeout=min(0.2, remaining))
                break
            except subprocess.TimeoutExpired:
                continue
    except Exception:
        proc.kill()
        proc.communicate()
        tmp.unlink(missing_ok=True)
        raise
    failed = proc.returncode != 0 or bool(cancel_check and cancel_check())
    if failed:
        with_stderr = stderr.strip()[-400:]
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        if cancel_check and cancel_check():
            raise ToolchainError("render cancelado")
        raise ToolchainError(f"ffmpeg falló: {with_stderr}")

    meta = probe_json(toolchain, tmp)
    duration = float(meta.get("format", {}).get("duration", 0) or 0)
    expected = plan["duration_us"] / 1_000_000
    if duration <= 0:
        tmp.unlink(missing_ok=True)
        raise ToolchainError("la salida del render no tiene duración válida")
    if abs(duration - expected) > 0.5:
        tmp.unlink(missing_ok=True)
        raise ToolchainError(
            f"la salida dura {duration:.2f}s y el snapshot esperaba {expected:.2f}s"
        )
    os_replace(tmp, output)
    return {
        "output": str(output),
        "durationUs": round(duration * 1_000_000),
        "streams": len(meta.get("streams", [])),
    }


def with_stderr(text: str) -> str:
    return text


def os_replace(tmp: Path, output: Path) -> None:
    import os

    os.replace(tmp, output)
