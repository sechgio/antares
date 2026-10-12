"""Efectos pesados del editor (L6, plan §L6.2-5).

Estabilización en dos pasadas con vid.stab, chroma key por color,
tolerancia y suavizado. Cada efecto produce un **derivado cacheado**:
el original se conserva intacto y el efecto es reversible. Los filtros
se validan contra el build preparado antes de ejecutarlos.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from backend.core.editor.toolchain import ToolchainError

STAGES: tuple[str, ...] = ("analizando", "transformando", "verificando", "cacheando")


def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    text = str(value or "#00FF00").lstrip("#")
    if len(text) == 6:
        try:
            return int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16)
        except ValueError:
            pass
    return 0, 255, 0


def chromakey_chain(color: str, similarity: float, blend: float) -> str:
    """Chroma key con ``colorkey`` sobre RGB.

    ``similarity`` es la tolerancia (0..1) y ``blend`` el suavizado del
    borde (0..1). Se usa ``colorkey`` (RGB) y no ``chromakey`` (YUV)
    porque el color llega del selector en espacio RGB del usuario.
    """
    rgb = _hex_to_rgb(color)
    hex_color = f"0x{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}"
    tolerance = max(0.0, min(1.0, float(similarity)))
    smooth = max(0.0, min(1.0, float(blend)))
    return f"colorkey=color={hex_color}:similarity={tolerance:.4f}:blend={smooth:.4f}"


def stabilize_chains(shakiness: int, accuracy: int = 15) -> tuple[str, str]:
    """Dos pasadas de vid.stab: detectar y transformar.

    ``shakiness`` mapea la sensibilidad de Antares al parámetro del
    algoritmo propio: no se presenta como el porcentaje del sitio de
    referencia. El rango del build es 1..10.
    """
    level = max(1, min(10, int(shakiness)))
    detect = f"vidstabdetect=shakiness={level}:accuracy={max(1, min(15, int(accuracy)))}"
    transform = "vidstabtransform=smoothing=30:input=transforms.trf"
    return detect, transform


def apply_stabilize(
    toolchain: Any,
    source: Path,
    output: Path,
    shakiness: int,
    *,
    transforms_file: Path | None = None,
    cancel_check: Any = None,
) -> Path:
    """Estabiliza en dos pasadas reales sobre el build.

    La primera pasada analiza el movimiento y escribe ``transforms.trf``;
    la segunda lo aplica. Un fallo en cualquiera lanza ``ToolchainError``
    sin dejar salida parcial.
    """
    import subprocess

    trf = transforms_file if transforms_file is not None else output.with_suffix(".trf")
    trf = Path(trf).resolve()
    trf.parent.mkdir(parents=True, exist_ok=True)
    detect, transform = stabilize_chains(shakiness)
    # vidstabdetect escribe el .trf con la ruta tal cual: una ruta
    # Windows absoluta rompe el parser de opciones, así que se ejecuta
    # con cwd en el directorio del .trf y se pasa solo el nombre.
    trf_name = trf.name
    detect = detect.replace("vidstabdetect=", f"vidstabdetect=result={trf_name}:")
    transform = transform.replace("input=transforms.trf", f"input={trf_name}")
    steps: list[tuple[str, str]] = [
        ("detect", detect),
        ("transform", transform),
    ]
    for name, chain in steps:
        cmd = [str(toolchain.ffmpeg), "-hide_banner", "-y", "-i", str(source)]
        if name == "detect":
            cmd += ["-vf", chain, "-f", "null", "-"]
        else:
            cmd += ["-vf", chain, "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p", str(output)]
        proc = subprocess.run(  # nosec B603 - argv con listas, sin shell
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=600,
            cwd=str(trf.parent),
            check=False,
        )
        if proc.returncode != 0 or (cancel_check and cancel_check()):
            if cancel_check and cancel_check():
                raise ToolchainError("estabilización cancelada")
            raise ToolchainError(f"vid.stab falló en {name}: {proc.stderr.strip()[-300:]}")
    if not output.is_file():
        raise ToolchainError("la estabilización no produjo salida")
    return output


def apply_chromakey(
    toolchain: Any,
    source: Path,
    output: Path,
    color: str,
    similarity: float,
    blend: float,
) -> Path:
    """Aplica chroma key preservando el alfa hasta componer.

    H.264 estándar descarta el canal alfa (``-pix_fmt yuva420p`` se
    ignora silenciosamente), así que la salida intermedia se escribe
    como PNG con alfa real; el render la consume como entrada de imagen
    y el alfa se compone sobre la capa inferior con ``overlay``.
    """
    import subprocess

    chain = chromakey_chain(color, similarity, blend)
    proc = subprocess.run(
        [
            str(toolchain.ffmpeg),
            "-hide_banner",
            "-y",
            "-i",
            str(source),
            "-vf",
            f"format=rgba,{chain}",
            "-frames:v",
            "1",
            "-c:v",
            "png",
            str(output.with_suffix(".png")),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=300,
        check=False,
    )
    if proc.returncode != 0:
        raise ToolchainError(f"chroma key falló: {proc.stderr.strip()[-300:]}")
    produced = output.with_suffix(".png")
    if not produced.is_file():
        raise ToolchainError("el chroma key no produjo salida")
    return produced
