from __future__ import annotations

import contextlib
import json
import os
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, NamedTuple

from backend.utils.validators import sanitizar_nombre


class AtomicOutputTarget(NamedTuple):
    tmp_path: Path
    destination: Path


@contextmanager
def atomic_output_file(
    resolved_path: str | Path,
    *,
    extension: str,
    overwrite: bool = False,
    write_token: object = None,
    exists_message: str = "El archivo ya existe: {path}",
) -> Iterator[AtomicOutputTarget]:
    resolved = Path(resolved_path)
    if write_token:
        # A write capability authorizes this exact path. Never rename it
        # through sanitization; only the convenience extension still applies.
        destination = resolved
        if not destination.name.lower().endswith(extension.lower()):
            destination = destination.with_name(destination.name + extension)
    else:
        safe = sanitizar_nombre(resolved.name) or resolved.name
        if not safe.lower().endswith(extension.lower()):
            safe += extension
        destination = resolved.parent / safe
    if destination.is_symlink() or destination.parent.is_symlink():
        raise ValueError("symlink no permitido en ruta de salida")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and not overwrite:
        raise FileExistsError(exists_message.format(path=destination))
    tmp = destination.with_name(f"{destination.name}.{uuid.uuid4().hex}.tmp")
    try:
        yield AtomicOutputTarget(tmp_path=tmp, destination=destination)
        if overwrite:
            os.replace(tmp, destination)
        elif destination.exists():
            raise FileExistsError(exists_message.format(path=destination))
        else:
            try:
                os.link(tmp, destination)
            except (OSError, NotImplementedError):
                if destination.exists():
                    raise FileExistsError(exists_message.format(path=destination)) from None
                os.rename(tmp, destination)
            else:
                # Link ya creó destination; un unlink fallido no debe reportar
                # FileExistsError sobre un archivo que sí se escribió.
                with contextlib.suppress(OSError):
                    os.unlink(tmp)
    except BaseException:
        with contextlib.suppress(OSError):
            tmp.unlink(missing_ok=True)
        raise


def atomic_write_text(path: str | Path, content: str) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = destination.with_name(f"{destination.name}.{uuid.uuid4().hex}.tmp")
    try:
        with tmp_path.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, destination)
    finally:
        tmp_path.unlink(missing_ok=True)


def atomic_write_json(path: str | Path, payload: Any, *, indent: int | None = 2) -> None:
    atomic_write_text(path, json.dumps(payload, ensure_ascii=False, indent=indent))
