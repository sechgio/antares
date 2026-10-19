"""Cancelación inmediata de operaciones en curso dentro de un run.

``_await_or_cancel`` corre una llamada bloqueante (HTTP, chat del proveedor) en
un hilo daemon y vuelve en cuanto el token del run se cancela; el hilo queda
huérfano pero su resultado se descarta.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

from backend.core.integrations.types import JsonObject
from backend.core.ipc_catalog import allows_raw_output_path, file_tokens_for, write_path_keys_for


class RunCancelled(Exception):
    """El run se canceló: la operación en curso se abandona de inmediato."""


def await_or_cancel(fn: Callable[[], Any], token: Any, poll_s: float = 0.1) -> Any:
    box: JsonObject = {}

    def target() -> None:
        try:
            box["value"] = fn()
        except BaseException as exc:  # se re-lanza abajo
            box["error"] = exc

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    while thread.is_alive():
        if token is not None and getattr(token, "cancelled", False):
            raise RunCancelled()
        thread.join(poll_s)
    if "error" in box:
        raise box["error"]
    return box.get("value")


class _CancelEvent:
    def __init__(self) -> None:
        self._event = threading.Event()

    def cancel(self) -> None:
        self._event.set()

    def wait(self, timeout: float) -> bool:
        return self._event.wait(timeout)

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()


def _validate_action_paths(method: str, args: JsonObject, memory: JsonObject) -> None:
    def values(value: Any, segments: tuple[str, ...]) -> list[Any]:
        if not segments:
            return [value]
        if segments[0] == "*":
            children = value.values() if isinstance(value, dict) else value if isinstance(value, list) else []
            return [item for child in children for item in values(child, segments[1:])]
        return values(value[segments[0]], segments[1:]) if isinstance(value, dict) and segments[0] in value else []

    read_paths = set(memory.get("read_paths") or [])
    write_roots = set(memory.get("write_roots") or [])
    for schema in (*file_tokens_for(method), ("_resolved_file_token_path",)):
        for value in values(args, schema):
            if not value or (isinstance(value, str) and value.startswith(("data:", "canvas-asset:"))):
                continue
            if not isinstance(value, str) or value not in read_paths:
                raise ValueError("El archivo del paso no está autorizado; elígelo o usa la entrada de imágenes")
            p = Path(value)
            if p.is_symlink() or any(parent.is_symlink() for parent in p.parents):
                raise ValueError("Enlaces simbólicos no permitidos")
    keys = write_path_keys_for(method) | {"outputPath", "output_path", "output_dir", "outputDir", "output_folder", "destino", "_resolved_output_path"}
    if allows_raw_output_path(method):
        keys |= {"path"}
    for key in keys:
        value = args.get(key)
        if not value:
            continue
        p = Path(value)
        if not p.is_absolute() or p.is_symlink() or any(parent.is_symlink() for parent in p.parents):
            raise ValueError("Ruta de salida inválida")
        destination = p.resolve()
        if not any(destination == Path(root).resolve() or Path(root).resolve() in destination.parents for root in write_roots):
            raise ValueError("El destino del paso no está autorizado; elige una carpeta de salida")
