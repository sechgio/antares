"""Archivos que el humano nombra en su mensaje: concesión de lectura por conversación.

Electron extrae las rutas absolutas del texto escrito por el usuario; aquí se
validan (ruta local real, sin ``..``, enlaces simbólicos ni puntos de reparse)
y se concede solo la lectura de ese archivo concreto. Una carpeta no se concede:
exige una selección explícita. Al usar la concesión se revalida la identidad
del archivo, de modo que uno sustituido después de nombrarlo se rechaza, y su
revisión (tamaño y fecha) entra en la huella de las aprobaciones.
"""

from __future__ import annotations

import ntpath
import os
from pathlib import Path

from backend.core.integrations.types import JsonObject

MAX_GRANTS_PER_MESSAGE = 20


def _key(path: str) -> str:
    return os.path.normcase(path)


def _resolve(raw: str) -> tuple[str, os.stat_result]:
    """Ruta real del archivo o ``ValueError`` con el motivo del rechazo."""
    if not isinstance(raw, str) or not raw or "\x00" in raw:
        raise ValueError("ruta vacía o inválida")
    if raw.startswith(("\\\\", "//")):
        raise ValueError("las rutas de red o de dispositivo no se admiten")
    if not ntpath.isabs(raw) and not os.path.isabs(raw):
        raise ValueError("la ruta debe ser absoluta")
    if ".." in Path(raw).parts:
        raise ValueError("la ruta no puede contener '..'")
    normalized = os.path.normpath(os.path.abspath(raw))
    real = os.path.realpath(normalized)
    path = Path(normalized)
    if path.is_symlink() or any(parent.is_symlink() for parent in path.parents) or _key(real) != _key(normalized):
        raise ValueError("los enlaces simbólicos y puntos de reparse no se admiten")
    if not path.exists():
        raise ValueError("el archivo no existe")
    if path.is_dir():
        raise ValueError("una carpeta requiere seleccionar los archivos concretos")
    if not path.is_file():
        raise ValueError("no es un archivo")
    return real, path.stat()


def grant_record(raw: str, request_id: str | None) -> JsonObject:
    real, stat = _resolve(raw)
    return {
        "path": real,
        "mode": "read",
        "dev": stat.st_dev,
        "ino": stat.st_ino,
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
        "request_id": request_id,
    }


def check(raw: str, grants: dict[str, JsonObject]) -> JsonObject:
    """Revalida una ruta contra las concesiones de la conversación."""
    try:
        real, stat = _resolve(raw)
    except ValueError as err:
        raise ValueError(f"El archivo no está autorizado: {err}") from None
    grant = grants.get(_key(real))
    if grant is None:
        raise ValueError("El archivo no está autorizado; escribe su ruta en tu mensaje o selecciónalo")
    if (grant.get("dev"), grant.get("ino")) != (stat.st_dev, stat.st_ino):
        raise ValueError("El archivo fue sustituido después de autorizarlo; vuelve a nombrarlo")
    return {"path": real, "size": stat.st_size, "mtime_ns": stat.st_mtime_ns}


def grant_key(record: JsonObject) -> str:
    return _key(str(record["path"]))
