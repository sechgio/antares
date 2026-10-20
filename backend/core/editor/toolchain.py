"""Resolución y verificación de la cadena de herramientas multimedia.

L0 del plan del editor: los ejecutables nativos se resuelven por
``resource_path('media/…')`` y **nunca** dependen de ``PATH``. Los tests
pueden apuntar a un build concreto con la variable de entorno
``ANTARES_FFMPEG_DIR``; en uso normal esa variable no existe.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess  # nosec B404 - uso acotado: argv fijo, shell=False
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.utils.paths import resource_path

# Capacidades mínimas que el build debe exponer para cubrir el alcance
# local del editor (L5 delogo, L6 estabilización/tono, L3 exportación).
REQUIRED_FILTERS: frozenset[str] = frozenset(
    {"delogo", "vidstabdetect", "vidstabtransform", "rubberband", "atempo", "boxblur", "chromakey"}
)
REQUIRED_ENCODERS: frozenset[str] = frozenset({"libx264", "libvpx-vp9", "aac", "libopus"})

_DEFAULT_TIMEOUT_S = 30


class ToolchainError(RuntimeError):
    """La cadena de herramientas multimedia no está disponible."""


@dataclass(frozen=True)
class Toolchain:
    ffmpeg: Path
    ffprobe: Path


def resolve_toolchain() -> Toolchain:
    """Localiza ffmpeg/ffprobe del build preparado.

    Orden: ``ANTARES_FFMPEG_DIR`` (solo para pruebas), ``media/`` del
    recurso. No se consulta ``PATH`` salvo en desarrollo explícito con
    ``ANTARES_FFMPEG_ALLOW_PATH=1``.
    """
    override = os.environ.get("ANTARES_FFMPEG_DIR")
    candidates: list[Path] = []
    if override:
        candidates.append(Path(override))
    candidates.append(resource_path("media"))
    for base in candidates:
        for suffix in (".exe", ""):
            ffmpeg = base / f"ffmpeg{suffix}"
            ffprobe = base / f"ffprobe{suffix}"
            if ffmpeg.is_file() and ffprobe.is_file():
                return Toolchain(ffmpeg=ffmpeg, ffprobe=ffprobe)
    if os.environ.get("ANTARES_FFMPEG_ALLOW_PATH") == "1":
        found_ffmpeg = shutil.which("ffmpeg")
        found_ffprobe = shutil.which("ffprobe")
        if found_ffmpeg and found_ffprobe:
            return Toolchain(ffmpeg=Path(found_ffmpeg), ffprobe=Path(found_ffprobe))
    raise ToolchainError(
        "No se encontró la cadena de herramientas multimedia. Ejecuta "
        "scripts/prepare-editor-media.js para preparar media/."
    )


def _run(tool: Path, args: list[str], timeout_s: int = _DEFAULT_TIMEOUT_S) -> str:
    proc = subprocess.run(  # nosec B603 - argv construido con listas, sin shell
        [str(tool), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout_s,
        check=False,
    )
    if proc.returncode != 0:
        raise ToolchainError(f"{tool.name} falló ({proc.returncode}): {proc.stderr.strip()[:400]}")
    return proc.stdout


def ffmpeg_version(toolchain: Toolchain) -> str:
    out = _run(toolchain.ffmpeg, ["-hide_banner", "-version"])
    first = out.splitlines()[0] if out else ""
    return first.strip()


def list_filters(toolchain: Toolchain) -> frozenset[str]:
    out = _run(toolchain.ffmpeg, ["-hide_banner", "-filters"])
    names: set[str] = set()
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[1].isidentifier():
            names.add(parts[1])
    return frozenset(names)


def list_encoders(toolchain: Toolchain) -> frozenset[str]:
    out = _run(toolchain.ffmpeg, ["-hide_banner", "-encoders"])
    names: set[str] = set()
    # Formato de ffmpeg: flags de 6 caracteres + espacio + nombre.
    # Algunos nombres llevan guion (libvpx-vp9), así que se toma el
    # segundo token cuando el primero tiene forma de flags.
    for line in out.splitlines():
        tokens = line.split()
        if len(tokens) >= 2 and set(tokens[0]) <= set("VASDX.BEIFS"):
            names.add(tokens[1])
    return frozenset(names)


def capabilities(toolchain: Toolchain) -> dict[str, Any]:  # allowlist: dict[str, Any]
    """Inventario de capacidades del build, con lo que falta marcado."""
    filters = list_filters(toolchain)
    encoders = list_encoders(toolchain)
    missing_filters = sorted(REQUIRED_FILTERS - filters)
    missing_encoders = sorted(REQUIRED_ENCODERS - encoders)
    return {
        "version": ffmpeg_version(toolchain),
        "missingFilters": missing_filters,
        "missingEncoders": missing_encoders,
        "ok": not missing_filters and not missing_encoders,
    }


def probe_json(toolchain: Toolchain, path: Path) -> dict[str, Any]:  # allowlist: dict[str, Any]
    """Metadatos procesables de un archivo mediante ffprobe JSON."""
    out = _run(
        toolchain.ffprobe,
        ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
    )
    return json.loads(out)  # type: ignore[no-any-return]


def verify_decodable(toolchain: Toolchain, path: Path) -> None:
    """Verifica que el archivo se decodifica completo sin errores.

    ffprobe tolera archivos truncados cuando el índice sigue íntegro
    (p. ej. MP4 con ``faststart``): la única prueba real de integridad
    es decodificar. Lanza ``ToolchainError`` si ffmpeg reporta errores.
    """
    proc = subprocess.run(  # nosec B603 - argv con listas, sin shell
        [str(toolchain.ffmpeg), "-v", "error", "-xerror", "-i", str(path), "-f", "null", "-"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=300,
        check=False,
    )
    if proc.returncode != 0 or proc.stderr.strip():
        detail = proc.stderr.strip()[:300] or f"código {proc.returncode}"
        raise ToolchainError(f"el archivo no se decodifica limpio: {detail}")


def synthesize_test_clip(toolchain: Toolchain, output: Path) -> Path:
    """Clip sintético breve (video con contador de cuadros + tono + silencio).

    Usa fuentes del propio build (``testsrc2``, ``sine``, ``anullsrc``),
    sin red ni archivos personales. Destruye el destino previo.
    """
    output.parent.mkdir(parents=True, exist_ok=True)
    _run(
        toolchain.ffmpeg,
        [
            "-hide_banner",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x240:rate=25:duration=5",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=5",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=48000:duration=5",
            "-filter_complex",
            "[0:v]format=yuv420p[v];[1:a]aformat=sample_rates=48000[a1];"
            "[2:a]aformat=sample_rates=48000[a2];[a1][a2]amix=inputs=2:duration=first[a]",
            "-map",
            "[v]",
            "-map",
            "[a]",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "30",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "96k",
            "-movflags",
            "+faststart",
            "-t",
            "5",
            str(output),
        ],
        timeout_s=120,
    )
    return output
