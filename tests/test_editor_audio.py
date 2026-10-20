from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pytest

from backend.core.editor.audio import (
    EQ_BANDS,
    audio_effect_chain,
    denoise_chain,
    eq_chain,
    pitch_chain,
    reverse_chain,
)
from backend.core.editor.toolchain import resolve_toolchain

BUILD_DIR = os.environ.get("ANTARES_FFMPEG_DIR", "")
pytestmark = pytest.mark.skipif(
    not BUILD_DIR or not Path(BUILD_DIR, "ffmpeg.exe").is_file(),
    reason="sin build FFmpeg preparado (ANTARES_FFMPEG_DIR)",
)

SCRATCH = Path(os.environ.get("TMPDIR", ".")) / "editor-audio-tests"


@pytest.fixture(scope="module")
def toolchain() -> Any:
    return resolve_toolchain()


@pytest.fixture(scope="module")
def clip(toolchain: Any) -> Path:
    from backend.core.editor.toolchain import synthesize_test_clip

    SCRATCH.mkdir(parents=True, exist_ok=True)
    return synthesize_test_clip(toolchain, SCRATCH / "clip_synth.mp4")


def _run_audio_filter(toolchain: Any, source: Path, af: str, output: Path) -> None:
    import subprocess

    proc = subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-i",
            str(source),
            "-af",
            af,
            "-c:a",
            "aac",
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


def test_eq_bands_are_ten() -> None:
    assert len(EQ_BANDS) == 10
    assert EQ_BANDS[0] == 32 and EQ_BANDS[-1] == 16000


def test_eq_skips_zero_gains() -> None:
    assert eq_chain([0, 0, 0]) == ""
    assert "equalizer=f=500" in eq_chain([0, 0, 0, 0, 6, 0])


def test_eq_clamps_to_contract_range() -> None:
    chain = eq_chain([100])
    assert "g=24" in chain
    chain = eq_chain([-100])
    assert "g=-24" in chain


def test_denoise_clamps_strength() -> None:
    assert denoise_chain(0) == ""
    assert "afftdn" in denoise_chain(0.5)
    assert "afftdn" in denoise_chain(5)


def test_pitch_semitones_to_ratio() -> None:
    assert pitch_chain(0) == ""
    assert "rubberband=pitch=2" in pitch_chain(12)
    assert "rubberband=pitch=0.5" in pitch_chain(-12)
    clamped = pitch_chain(24)
    assert "pitch=2" in clamped
    clamped = pitch_chain(-24)
    assert "pitch=0.5" in clamped


def test_unknown_effect_rejected() -> None:
    with pytest.raises(ValueError, match="desconocido"):
        audio_effect_chain([{"type": "telepatia"}])


def test_eq_runs_on_real_audio(toolchain: Any, clip: Path) -> None:
    out = SCRATCH / "eq.m4a"
    _run_audio_filter(toolchain, clip, eq_chain([0, 3, 0, 0, -3, 0, 0, 0, 0, 0]), out)
    assert out.is_file()


def test_reverse_runs_on_real_audio(toolchain: Any, clip: Path) -> None:
    out = SCRATCH / "reverse.m4a"
    _run_audio_filter(toolchain, clip, reverse_chain(), out)
    assert out.is_file()


def test_denoise_runs_on_real_audio(toolchain: Any, clip: Path) -> None:
    out = SCRATCH / "denoise.m4a"
    _run_audio_filter(toolchain, clip, denoise_chain(0.7), out)
    assert out.is_file()


def test_pitch_preserves_duration(toolchain: Any, clip: Path) -> None:
    from backend.core.editor.toolchain import probe_json

    out = SCRATCH / "pitch.m4a"
    _run_audio_filter(toolchain, clip, pitch_chain(5), out)
    meta = probe_json(toolchain, out)
    audio = next(s for s in meta["streams"] if s["codec_type"] == "audio")
    duration = float(audio.get("duration", meta["format"]["duration"]))
    assert 4.7 <= duration <= 5.3, f"el tono cambió la duración: {duration}"


def test_full_effect_chain_runs(toolchain: Any, clip: Path) -> None:
    out = SCRATCH / "chain.m4a"
    chain = audio_effect_chain(
        [
            {"type": "eq", "bandGainDb": [0, 0, 0, 0, 4, 0, 0, 0, 0, 0]},
            {"type": "denoise", "params": {"strength": 0.4}},
        ],
        gain_db=-3,
    )
    assert "volume=-3dB" in chain
    _run_audio_filter(toolchain, clip, chain, out)
    assert out.is_file()


def test_pitch_and_eq_combined(toolchain: Any, clip: Path) -> None:
    out = SCRATCH / "pitch_eq.m4a"
    chain = audio_effect_chain(
        [
            {"type": "eq", "bandGainDb": [0, 0, 0, 0, 0, 0, 3, 0, 0, 0]},
            {"type": "pitch", "semitones": -3},
        ],
    )
    _run_audio_filter(toolchain, clip, chain, out)
    assert out.is_file()
