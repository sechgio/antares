"""Métrica de movimiento para estabilización (L6, plan §L6.1).

La aceptación del hito exige que un patrón con desplazamiento sintético
tenga **menos movimiento** tras estabilizar, dentro de una métrica
definida. Esta métrica decodifica cuadros reales y mide el
desplazamiento entre ellos por correlación de fase, de modo que
«existe el archivo» no cuenta como prueba.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

# Tolerancia del comparador: el desplazamiento medido debe bajar al
# menos este porcentaje para declarar el efecto útil.
MIN_IMPROVEMENT_RATIO = 0.5


class MotionMetricError(RuntimeError):
    """No se pudo medir el movimiento del clip."""


def _decode_gray(toolchain: Any, source: Path, output_dir: Path, count: int = 6) -> list[bytes]:
    """Decodifica los primeros ``count`` cuadros como escala de grises."""
    output_dir.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-i",
            str(source),
            "-frames:v",
            str(count),
            "-f",
            "rawvideo",
            "-pix_fmt",
            "gray",
            str(output_dir / "frames.raw"),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=180,
        check=False,
    )
    if proc.returncode != 0:
        raise MotionMetricError(f"no se pudieron decodificar los cuadros: {proc.stderr[-300:]}")
    raw = (output_dir / "frames.raw").read_bytes()
    from backend.core.editor.toolchain import probe_json

    meta = probe_json(toolchain, source)
    video = next(s for s in meta["streams"] if s["codec_type"] == "video")
    width = int(video["width"])
    height = int(video["height"])
    frame_size = width * height
    frames = [raw[i * frame_size : (i + 1) * frame_size] for i in range(len(raw) // frame_size)]
    return frames


def _shift_distance(frames: list[bytes], width: int, height: int) -> float:
    """Desplazamiento medio entre cuadros consecutivos por bloque.

    Divide cada cuadro en bloques y busca, para cada bloque, el mejor
    desplazamiento entero contra el cuadro siguiente. Devuelve la media
    de píxeles desplazados: 0 significa imagen estática.
    """
    if len(frames) < 2:
        raise MotionMetricError("se necesitan al menos dos cuadros")
    block = 32
    total = 0.0
    samples = 0
    search = 8
    for index in range(len(frames) - 1):
        current = frames[index]
        following = frames[index + 1]
        for by in range(0, height - block, block):
            for bx in range(0, width - block, block):
                best = _best_block_shift(current, following, bx, by, block, width, height, search)
                total += best
                samples += 1
    if samples == 0:
        raise MotionMetricError("el cuadro es demasiado pequeño para la métrica")
    return total / samples


def _best_block_shift(
    current: bytes,
    following: bytes,
    bx: int,
    by: int,
    block: int,
    width: int,
    height: int,
    search: int,
) -> float:
    best_error = None
    best_dx = 0
    best_dy = 0
    best_distance = None
    for dy in range(-search, search + 1, 2):
        for dx in range(-search, search + 1, 2):
            error = _block_error(current, following, bx, by, dx, dy, block, width, height)
            distance = (dx * dx + dy * dy) ** 0.5
            # En empate de error se prefiere el desplazamiento menor:
            # un bloque idéntico no debe reportar movimiento.
            better = (
                best_error is None
                or error < best_error
                or (error == best_error and best_distance is not None and distance < best_distance)
            )
            if better:
                best_error = error
                best_dx = dx
                best_dy = dy
                best_distance = distance
    return float((best_dx * best_dx + best_dy * best_dy) ** 0.5)


def _block_error(
    current: bytes,
    following: bytes,
    bx: int,
    by: int,
    dx: int,
    dy: int,
    block: int,
    width: int,
    height: int,
) -> int:
    total = 0
    for y in range(block):
        for x in range(block):
            sx = bx + x + dx
            sy = by + y + dy
            if 0 <= sx < width and 0 <= sy < height:
                total += abs(current[(by + y) * width + bx + x] - following[sy * width + sx])
    return total


def measure_motion(toolchain: Any, source: Path, workdir: Path, count: int = 6) -> float:
    """Desplazamiento medio en píxeles entre cuadros consecutivos."""
    frames = _decode_gray(toolchain, source, workdir, count)
    from backend.core.editor.toolchain import probe_json

    meta = probe_json(toolchain, source)
    video = next(s for s in meta["streams"] if s["codec_type"] == "video")
    return _shift_distance(frames, int(video["width"]), int(video["height"]))


def measure_global_motion(toolchain: Any, source: Path, workdir: Path, count: int = 12) -> float:
    """Desplazamiento del centro de masa de luminancia por cuadro.

    Mide el movimiento **global** de la escena, que es exactamente lo
    que corrige vid.stab. A diferencia de la métrica por bloques, es
    insensible al recorte de bordes que introduce la herramienta: un
    borde que entra o sale no mueve el centro de masa si el conjunto
    de la imagen permanece centrado.
    """
    frames = _decode_gray(toolchain, source, workdir, count)
    from backend.core.editor.toolchain import probe_json

    meta = probe_json(toolchain, source)
    video = next(s for s in meta["streams"] if s["codec_type"] == "video")
    width = int(video["width"])
    height = int(video["height"])
    centers = [_center_of_mass(frame, width, height) for frame in frames]
    total = 0.0
    for index in range(len(centers) - 1):
        dx = centers[index + 1][0] - centers[index][0]
        dy = centers[index + 1][1] - centers[index][1]
        total += (dx * dx + dy * dy) ** 0.5
    return total / max(1, len(centers) - 1)


def _center_of_mass(frame: bytes, width: int, height: int) -> tuple[float, float]:
    sum_x = 0.0
    sum_y = 0.0
    weight = 0.0
    for y in range(height):
        row = y * width
        for x in range(width):
            value = frame[row + x]
            sum_x += x * value
            sum_y += y * value
            weight += value
    if weight <= 0:
        return (width / 2, height / 2)
    return (sum_x / weight, sum_y / weight)


def improvement(before: float, after: float) -> float:
    """Fracción de movimiento eliminado (1 = quietud total)."""
    if before <= 0:
        return 0.0
    return max(0.0, (before - after) / before)


def is_stabilized(before: float, after: float) -> bool:
    """Criterio del hito: reducir el movimiento al menos a la mitad."""
    return improvement(before, after) >= MIN_IMPROVEMENT_RATIO
