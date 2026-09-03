
from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any


def is_safe_user_path(value: object) -> bool:
    if not isinstance(value, str) or not value:
        return True
    if "\x00" in value:
        return False
    if "../" in value or "..\\" in value or value.endswith(("/..", "\\..")) or value in ("..", "."):
        return False
    if any(part == ".." for part in Path(value).parts):
        return False
    lowered = value.lower()
    return not (
        "%2e%2e" in lowered
        or "%252e" in lowered
        or "%2f" in lowered
        or "%5c" in lowered
        or "%252f" in lowered
        or "%255c" in lowered
    )


_WINDOWS_RESERVED_NAMES = frozenset(
    {
        "CON",
        "PRN",
        "AUX",
        "NUL",
        *(f"COM{i}" for i in range(1, 10)),
        *(f"LPT{i}" for i in range(1, 10)),
    }
)


def sanitizar_nombre(nombre: str | Path) -> str:
    nombre_str = str(nombre).strip()

    if "../" in nombre_str or "..\\" in nombre_str:
        nombre_str = Path(nombre_str).name

    nombre_limpio = re.sub(r'[<>\:"/\\|?*]', "_", nombre_str)

    nombre_limpio = re.sub(r"[\x00-\x1F\x7F]", "", nombre_limpio)

    nombre_limpio = re.sub(r"\s+", " ", nombre_limpio)

    nombre_limpio = nombre_limpio.lstrip(".")

    cleaned = nombre_limpio.strip("_. ")
    if not cleaned:
        return ""

    stem = Path(cleaned).stem.upper()
    if stem in _WINDOWS_RESERVED_NAMES:
        cleaned = f"_{cleaned}"

    return cleaned


def obtener_codigo_desde_nombre(nombre_archivo: str | Path) -> str:
    nombre_limpio = Path(nombre_archivo).name
    if "../" in nombre_limpio or "..\\" in nombre_limpio:
        nombre_limpio = nombre_limpio.replace("../", "").replace("..\\", "")
    return Path(nombre_limpio).stem


def parse_filename_parts(nombre_archivo: str | Path) -> tuple[str, str]:
    stem = Path(nombre_archivo).stem
    match = re.match(r"^(.+)[_-](\d+)$", stem)
    if match:
        seq = match.group(2)
        if not (len(seq) == 4 and seq.startswith(("19", "20"))):
            return match.group(1), seq
    match = re.match(r"^(.+) \((\d+)\)$", stem)
    if match:
        return match.group(1), match.group(2)
    return stem, "1"


KNOWN_PATH_KEYS: frozenset[str] = frozenset({
    "files", "destino", "path", "folder", "name",
    "directory", "output", "source", "target", "filename", "filepath",
})

PATH_KEY_SUFFIXES: tuple[str, ...] = (
    "_path", "_paths", "_folder", "_folders", "_dir", "_directory",
    "_file", "_files", "_filename",
)


def is_path_like_key(key: str) -> bool:
    if key in KNOWN_PATH_KEYS:
        return True
    snake = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", key).lower()
    return any(snake.endswith(suffix) for suffix in PATH_KEY_SUFFIXES)


def _path_item_violates(item: object, *, strict: bool) -> bool:
    if strict:
        return not isinstance(item, str) or not item or not is_safe_user_path(item)
    return not is_safe_user_path(item)


def path_param_violations(params: object, *, strict: bool = False) -> Iterator[tuple[str, Any]]:
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
