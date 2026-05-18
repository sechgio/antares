"""Utilidades de validación para rutas y nombres de archivo."""

from __future__ import annotations

import re
from pathlib import Path

_EXTENSIONES_IMAGEN: set[str] = {
    ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif", ".gif", ".ico",
}


def es_imagen(ruta: str | Path) -> bool:
    """Verifica si la ruta corresponde a una imagen soportada.

    Args:
        ruta: Ruta del archivo a validar.

    Returns:
        True si la extensión está en el conjunto de formatos soportados.
    """
    return Path(ruta).suffix.lower() in _EXTENSIONES_IMAGEN


def is_safe_user_path(value: object) -> bool:
    """Return whether a user-provided path string avoids traversal patterns."""
    if not isinstance(value, str) or not value:
        return True
    if "\x00" in value:
        return False
    if "../" in value or "..\\" in value or value.endswith(("/..", "\\..")) or value in ("..", "."):
        return False
    lowered = value.lower()
    return not ("%2e%2e" in lowered or "%252e" in lowered)


def sanitizar_nombre(nombre: str | Path) -> str:
    """Elimina caracteres no válidos para nombres de archivo en Windows/Linux.

    Also prevents path traversal attacks.

    Args:
        nombre: Nombre de archivo a sanitizar.

    Returns:
        Nombre limpio con caracteres inválidos reemplazados por guiones bajos.
    """
    nombre_str = str(nombre).strip()

    if "../" in nombre_str or "..\\" in nombre_str:
        # Extract just the filename without path
        nombre_str = Path(nombre_str).name

    # Caracteres no permitidos en Windows: < > : " / \ | ? *
    nombre_limpio = re.sub(r'[<>\:"/\\|?*]', "_", nombre_str)

    nombre_limpio = re.sub(r"[\x00-\x1F\x7F]", "", nombre_limpio)

    nombre_limpio = re.sub(r"\s+", " ", nombre_limpio)

    # Prevent names starting with dots (hidden files on Unix)
    nombre_limpio = nombre_limpio.lstrip(".")

    return nombre_limpio.strip("_. ")


def obtener_codigo_desde_nombre(nombre_archivo: str | Path) -> str:
    """Extrae el código base del nombre del archivo (stem sin extensión).

    Sanitizes path traversal before extracting the stem to prevent
    directory traversal attacks.

    Args:
        nombre_archivo: Nombre o ruta del archivo.

    Returns:
        Stem del archivo como cadena de texto sanitizada.
    """
    # Extract just the filename to neutralize any path components
    nombre_limpio = Path(nombre_archivo).name
    # Strip traversal sequences from the filename itself
    if "../" in nombre_limpio or "..\\" in nombre_limpio:
        nombre_limpio = nombre_limpio.replace("../", "").replace("..\\", "")
    return Path(nombre_limpio).stem


def parse_filename_parts(nombre_archivo: str | Path) -> tuple[str, str]:
    """Extrae (grupo, secuencia) del nombre de archivo.

    Formato esperado: '{grupo}_{secuencia}.ext' o '{grupo}-{secuencia}.ext'
    Ejemplos:
        '1_1.jpg'        -> ('1', '1')
        '69466481-1.jpg' -> ('69466481', '1')
        'abc.jpg'        -> ('abc', '1')  # fallback sin secuencia

    Args:
        nombre_archivo: Nombre o ruta del archivo.

    Returns:
        Tupla (grupo, secuencia). Si no se encuentra separador, secuencia='1'.
    """
    stem = Path(nombre_archivo).stem
    match = re.match(r"^(.+)[_-](\d+)$", stem)
    if match:
        return match.group(1), match.group(2)
    return stem, "1"
