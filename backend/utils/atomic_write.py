from __future__ import annotations

import contextlib
import os
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import NamedTuple

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
        # A write capability authorizes this exact path — never rename it
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
                os.unlink(tmp)
            except (OSError, NotImplementedError):
                if destination.exists():
                    raise FileExistsError(exists_message.format(path=destination)) from None
                os.rename(tmp, destination)
    except BaseException:
        with contextlib.suppress(OSError):
            tmp.unlink(missing_ok=True)
        raise
