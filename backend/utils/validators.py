"""Utilidades de validación para rutas y nombres de archivo."""

from __future__ import annotations

import re
from pathlib import Path

_EXTENSIONES_IMAGEN: set[str] = {
    ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif", ".gif", ".ico", ".pdf"
}


def es_imagen(ruta: str | Path) -> bool:
    """Verifica si la ruta corresponde a una imagen soportada.

    Args:
        ruta: Ruta del archivo a validar.

    Returns:
        True si la extensión está en el conjunto de formatos soportados.
    """
    return Path(ruta).suffix.lower() in _EXTENSIONES_IMAGEN


def sanitizar_nombre(nombre: str | Path) -> str:
    """Elimina caracteres no válidos para nombres de archivo en Windows/Linux.

    Also prevents path traversal attacks.

    Args:
        nombre: Nombre de archivo a sanitizar.

    Returns:
        Nombre limpio con caracteres inválidos reemplazados por guiones bajos.
    """
    nombre_str = str(nombre).strip()

    # First, check for path traversal attempts
    if '../' in nombre_str or '..\\' in nombre_str:
        # Extract just the filename without path
        nombre_str = Path(nombre_str).name

    # Caracteres no permitidos en Windows: < > : " / \ | ? *
    nombre_limpio = re.sub(r'[<>\:"/\\|?*]', "_", nombre_str)

    # Remove control characters (0x00-0x1F, 0x7F)
    nombre_limpio = re.sub(r'[\x00-\x1F\x7F]', '', nombre_limpio)

    # Eliminar espacios múltiples
    nombre_limpio = re.sub(r'\s+', " ", nombre_limpio)

    # Prevent names starting with dots (hidden files on Unix)
    nombre_limpio = nombre_limpio.lstrip('.')

    return nombre_limpio.strip("_. ")


def obtener_codigo_desde_nombre(nombre_archivo: str | Path) -> str:
    """Extrae el código base del nombre del archivo (stem sin extensión).

    Args:
        nombre_archivo: Nombre o ruta del archivo.

    Returns:
        Stem del archivo como cadena de texto.
    """
    return Path(nombre_archivo).stem


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
