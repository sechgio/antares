from __future__ import annotations

import math
from typing import Any


def _num(value: Any) -> str:
    f = float(value)
    if f == int(f):
        return str(int(f))
    return repr(round(f, 6))


def trim_video(source_in_us: int, source_out_us: int, fps_num: int, fps_den: int) -> str:
    start = _us_to_seconds(source_in_us)
    end = _us_to_seconds(source_out_us)
    # trim es semiabierto en el sentido de descartar >= end; se usa un
    # epsilon de un microsegundo para incluir el último cuadro.
    end_adj = end + 1e-6
    return f"trim=start={_num(start)}:end={_num(end_adj)},setpts=PTS-STARTPTS"


def _us_to_seconds(us: int) -> float:
    return us / 1_000_000


def speed(speed_num: int, speed_den: int, has_audio: bool) -> str:
    """Velocidad racional: vídeo por setpts, audio por atempo encadenado.

    ``speed = num/den``: 2/1 es doble de velocidad, 1/2 es media.
    ``setpts`` multiplica los PTS, así que ralentizar (speed<1) estira
    el tiempo con un factor ``den/num`` > 1; ``atempo`` toma el factor
    de velocidad directamente (0.5 = más lento).
    """
    if speed_num == speed_den:
        return ""
    pts_factor = speed_den / speed_num
    parts = [f"setpts=PTS*{_num(pts_factor)}"]
    if has_audio:
        tempo = speed_num / speed_den
        for factor in _atempo_chain(tempo):
            parts.append(f"atempo={_num(factor)}")
    return ",".join(parts)


def _atempo_chain(ratio: float) -> list[float]:
    if 0.5 <= ratio <= 2.0:
        return [ratio]
    factors: list[float] = []
    remaining = ratio
    while remaining > 2.0:
        factors.append(2.0)
        remaining /= 2.0
    while remaining < 0.5:
        factors.append(0.5)
        remaining /= 0.5
    factors.append(remaining)
    return factors


def crop(x: float, y: float, w: float, h: float, width_px: int, height_px: int) -> str:
    cw = _even(max(2, round(w * width_px)))
    ch = _even(max(2, round(h * height_px)))
    cx = _even(max(0, min(round(x * width_px), width_px - cw)))
    cy = _even(max(0, min(round(y * height_px), height_px - ch)))
    return f"crop={cw}:{ch}:{cx}:{cy}"


def _even(value: int) -> int:
    return value - (value % 2)


def rotate(deg: float) -> str:
    """Giro: múltiplos de 90 por transpose, ángulo libre por rotate.

    ``rotate`` con ``ow=rotw()/oh=roth()`` falla en el build (la
    expresión no se evalúa como se esperaba); sin ellas ffmpeg calcula
    el tamaño de salida y rellena con negro, que es lo que necesita la
    política de lienzo del editor.
    """
    normalized = deg % 360
    if normalized == 0:
        return ""
    if normalized == 90:
        return "transpose=1"
    if normalized == 180:
        return "transpose=1,transpose=1"
    if normalized == 270:
        return "transpose=2"
    rad = math.radians(deg)
    return f"rotate={_num(rad)}:c=black"


def flip(flip_x: bool, flip_y: bool) -> str:
    parts: list[str] = []
    if flip_x:
        parts.append("hflip")
    if flip_y:
        parts.append("vflip")
    return ",".join(parts)


def fit_canvas(
    src_w: int,
    src_h: int,
    canvas_w: int,
    canvas_h: int,
    fit: str,
) -> str:
    if fit == "fill":
        scale = max(canvas_w / max(src_w, 1), canvas_h / max(src_h, 1))
    else:
        scale = min(canvas_w / max(src_w, 1), canvas_h / max(src_h, 1))
    w = _even(max(2, round(src_w * scale)))
    h = _even(max(2, round(src_h * scale)))
    parts = [f"scale={w}:{h}"]
    if fit == "fill":
        parts.append(f"crop={canvas_w}:{canvas_h}")
    else:
        parts.append(
            f"pad={canvas_w}:{canvas_h}:(ow-iw)/2:(oh-ih)/2:color=black"
        )
    return ",".join(parts)


def opacity(alpha: float) -> str:
    if alpha >= 1.0:
        return ""
    return f"format=yuva420p,colorchannelmixer=aa={_num(alpha)}"


def delogo_rects(rects: list[dict[str, Any]], width_px: int, height_px: int) -> list[str]:  # allowlist: dict[str, Any]
    """FFmpeg exige que el rectángulo quede dentro del fotograma."""
    filters: list[str] = []
    for rect in rects:
        x = round(float(rect["x"]) * width_px)
        y = round(float(rect["y"]) * height_px)
        w = round(float(rect["width"]) * width_px)
        h = round(float(rect["height"]) * height_px)
        if w < 8 or h < 8:
            raise ValueError("la máscara delogo es demasiado pequeña (mínimo 8x8 píxeles)")
        if x < 0 or y < 0 or x + w > width_px or y + h > height_px:
            raise ValueError(
                "la máscara delogo excede el fotograma; acércala a la región visible"
            )
        # El filtro delogo del build rechaza rectángulos que toquen el
        # borde exacto ("Logo area is outside of the frame" cuando y+h o
        # x+w igualan la dimensión): se exige un píxel de margen.
        if x + w >= width_px or y + h >= height_px:
            raise ValueError(
                "la máscara delogo toca el borde del fotograma; deja al menos un píxel de margen"
            )
        filters.append(f"delogo=x={x}:y={y}:w={w}:h={h}")
    return filters


def audio_gain(gain_db: float) -> str:
    if gain_db == 0:
        return ""
    return f"volume={_num(gain_db)}dB"


def setpts_shift(timeline_start_us: int) -> str:
    if timeline_start_us <= 0:
        return ""
    return f"setpts=PTS+{_num(_us_to_seconds(timeline_start_us))}/TB"


def audio_tempo(speed_num: int, speed_den: int) -> str:
    """Tempo de audio (``atempo``) para una velocidad racional.

    Sin ``setpts``: eso es de video. ``atempo`` admite [0.5, 2.0] por
    filtro, así que se encadenan raíces para extremos.
    """
    if speed_num == speed_den:
        return ""
    tempo = speed_num / speed_den
    return ",".join(f"atempo={_num(factor)}" for factor in _atempo_chain(tempo))


def delay_audio(timeline_start_us: int) -> str:
    """Silencio inicial para ubicar el audio en la timeline.

    ``adelay`` trabaja en **milisegundos**, no microsegundos: pasar el
    valor en µs multiplicaría el desplazamiento por 1000.
    """
    if timeline_start_us <= 0:
        return ""
    ms = timeline_start_us // 1000
    if ms <= 0:
        return ""
    return f"adelay={ms}|{ms}"


def audio_fades(fade_in_us: int, fade_out_us: int, duration_us: int) -> str:
    parts: list[str] = []
    if fade_in_us > 0:
        parts.append(f"afade=t=in:st=0:d={_num(_us_to_seconds(fade_in_us))}")
    if fade_out_us > 0:
        start = max(0.0, _us_to_seconds(duration_us - fade_out_us))
        parts.append(f"afade=t=out:st={_num(start)}:d={_num(_us_to_seconds(fade_out_us))}")
    return ",".join(parts)


def overlay(x_expr: str, y_expr: str) -> str:
    return f"overlay={x_expr}:{y_expr}"
