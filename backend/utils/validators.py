"""Utilidades de validación para rutas y nombres de archivo."""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any


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

    Formatos esperados: '{grupo}_{secuencia}.ext', '{grupo}-{secuencia}.ext'
    o el sufijo de copia de Windows '{grupo} ({secuencia}).ext'.
    Ejemplos:
        '1_1.jpg'        -> ('1', '1')
        '69466481-1.jpg' -> ('69466481', '1')
        '4210502 (2).jpg' -> ('4210502', '2')
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
    match = re.match(r"^(.+) \((\d+)\)$", stem)
    if match:
        return match.group(1), match.group(2)
    return stem, "1"


# ─── Path parameter heuristic validation (shared between IPC and handlers) ──
# Single source of truth to avoid duplication between defense-in-depth layers.

# Keys whose values are always treated as filesystem paths.
KNOWN_PATH_KEYS: frozenset[str] = frozenset({
    "files", "destino", "path", "folder", "name",
    "directory", "output", "source", "target", "filename", "filepath",
})

# Heuristic suffixes for keys that newer handlers may use without us knowing.
# Catches things like "output_path", "input_folder", "logo_file", "src_dir", etc.
PATH_KEY_SUFFIXES: tuple[str, ...] = (
    "_path", "_paths", "_folder", "_folders", "_dir", "_directory",
    "_file", "_files", "_filename",
)


def is_path_like_key(key: str) -> bool:
    """Heuristic: does this key name imply its value is a filesystem path?

    This is the canonical implementation used by both:
    - backend.ipc_protocol (early defense-in-depth on incoming messages)
    - backend.handlers.common @validate_params decorator (authoritative handler layer)

    Keeping this in one place prevents the two layers from drifting.

    Recognises both snake_case (``output_path``) and camelCase (``excelPath``,
    ``outputDir``) path keys by normalising camelCase to snake_case before
    applying the suffix heuristic.
    """
    if key in KNOWN_PATH_KEYS:
        return True
    snake = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", key).lower()
    return any(snake.endswith(suffix) for suffix in PATH_KEY_SUFFIXES)


def _path_item_violates(item: object, *, strict: bool) -> bool:
    """Does a single path-collection item fail safety screening?"""
    if strict:
        # The handler decorator rejects empty/non-str items as "Invalid path"
        # in addition to traversal attempts.
        return not isinstance(item, str) or not item or not is_safe_user_path(item)
    # The IPC boundary only screens for traversal; non-str/empty values pass.
    return not is_safe_user_path(item)


def path_param_violations(params: object, *, strict: bool = False) -> Iterator[tuple[str, Any]]:
    """Yield ``(key, value)`` for each path-like param that fails screening.

    Single source of truth for the screening loop shared by:
    - ``backend.ipc_protocol.validate_params`` (defense-in-depth IPC boundary)
    - ``backend.handlers.common.@validate_params`` (authoritative handler layer)

    ``strict=False`` mirrors the IPC boundary: ``is_safe_user_path`` is the only
    gate, so non-str / empty values pass (they are not traversal attempts).

    ``strict=True`` mirrors the handler decorator: empty or non-str items inside
    path collections (lists/dicts) are also flagged, and empty scalar strings
    are flagged. Non-str *scalar* values are never flagged by either layer —
    both only screen ``str`` scalars.
    """
    if not isinstance(params, dict):
        return
    for key, value in params.items():
        if value is None:
            continue
        if not is_path_like_key(key):
            continue
        if isinstance(value, list):
            for item in value:
                if _path_item_violates(item, strict=strict):
                    yield key, item
        elif isinstance(value, dict):
            for item in value.values():
                if item is None:
                    continue
                if _path_item_violates(item, strict=strict):
                    yield key, item
        elif isinstance(value, str) and _path_item_violates(value, strict=strict):
            yield key, value
