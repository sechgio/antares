from __future__ import annotations

from typing import Any

from backend.core.editor import filters

EQ_BANDS: tuple[int, ...] = (32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000)


def eq_chain(band_gains_db: list[float]) -> str:
    if not band_gains_db:
        return ""
    parts: list[str] = []
    for index, gain in enumerate(band_gains_db[: len(EQ_BANDS)]):
        if gain == 0:
            continue
        clamped = max(-24.0, min(24.0, float(gain)))
        parts.append(f"equalizer=f={EQ_BANDS[index]}:width_type=o:width=1:g={filters._num(clamped)}")
    return ",".join(parts)


def reverse_chain() -> str:
    return "areverse"


def denoise_chain(strength: float) -> str:
    """Reducción de ruido convencional con ``afftdn``.

    Etiquetada como reducción de ruido, no separación de voces. El
    rango válido de ``nr`` en el build es [0.01, 97]: valores fuera se
    rechazan en el proceso hijo, así que se acota aquí.
    """
    amount = max(0.0, min(1.0, float(strength)))
    if amount <= 0:
        return ""
    noise_db = max(0.01, min(97.0, 97.0 - amount * 96.99))
    return f"afftdn=nr={filters._num(noise_db)}:nf=-25"


def pitch_chain(semitones: float) -> str:
    if semitones == 0:
        return ""
    clamped = max(-12.0, min(12.0, float(semitones)))
    return f"rubberband=pitch={filters._num(2 ** (clamped / 12))}"


def audio_effect_chain(effects: list[dict[str, Any]], *, gain_db: float = 0.0) -> str:  # allowlist: dict[str, Any]
    parts: list[str] = []
    gain = filters.audio_gain(gain_db)
    if gain:
        parts.append(gain)
    for effect in effects:
        kind = str(effect.get("type", ""))
        if kind == "eq":
            chain = eq_chain([float(g) for g in effect.get("bandGainDb", [])])
        elif kind == "reverse":
            chain = reverse_chain()
        elif kind == "denoise":
            chain = denoise_chain(float(effect.get("params", {}).get("strength", 0.5)))
        elif kind == "pitch":
            chain = pitch_chain(float(effect.get("semitones", 0)))
        else:
            raise ValueError(f"efecto de audio desconocido: {kind}")
        if chain:
            parts.append(chain)
    return ",".join(parts)
