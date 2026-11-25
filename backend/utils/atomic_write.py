from __future__ import annotations

import contextlib
import json
import os
import stat
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, NamedTuple

from backend.utils.validators import sanitizar_nombre


class AtomicOutputTarget(NamedTuple):
    tmp_path: Path
    destination: Path


def _is_symlink_or_reparse(path: Path) -> bool:
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return False
    if stat.S_ISLNK(info.st_mode):
        return True
    reparse_attr = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    return bool(reparse_attr and getattr(info, "st_file_attributes", 0) & reparse_attr)


def _assert_not_symlink_or_reparse(path: Path) -> None:
    if _is_symlink_or_reparse(path):
        raise ValueError("symlink/reparse no permitido en ruta de salida")


def _assert_output_location_safe(destination: Path) -> None:
    _assert_not_symlink_or_reparse(destination)
    _assert_not_symlink_or_reparse(destination.parent)


def _open_exclusive_tmp(path: Path) -> int:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
    return os.open(path, flags, 0o600)


@contextmanager
def atomic_output_file(
    resolved_path: str | Path,
    *,
    extension: str | None,
    overwrite: bool = False,
    write_token: object = None,
    exists_message: str = "El archivo ya existe: {path}",
) -> Iterator[AtomicOutputTarget]:
    resolved = Path(resolved_path)
    if write_token:
        destination = resolved
        if extension and not destination.name.lower().endswith(extension.lower()):
            destination = destination.with_name(destination.name + extension)
    else:
        safe = sanitizar_nombre(resolved.name) or resolved.name
        if extension and not safe.lower().endswith(extension.lower()):
            safe += extension
        destination = resolved.parent / safe
    _assert_output_location_safe(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    _assert_output_location_safe(destination)
    if destination.exists() and not overwrite:
        raise FileExistsError(exists_message.format(path=destination))
    tmp = destination.with_name(f"{destination.name}.{uuid.uuid4().hex}.tmp")
    _assert_output_location_safe(destination)
    tmp_fd = _open_exclusive_tmp(tmp)
    try:
        yield AtomicOutputTarget(tmp_path=tmp, destination=destination)
        _assert_output_location_safe(destination)
        _assert_not_symlink_or_reparse(tmp)
        os.fsync(tmp_fd)
        os.close(tmp_fd)
        tmp_fd = -1
        _assert_output_location_safe(destination)
        _assert_not_symlink_or_reparse(tmp)
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
                with contextlib.suppress(OSError):
                    os.unlink(tmp)
    except BaseException:
        if tmp_fd >= 0:
            with contextlib.suppress(OSError):
                os.close(tmp_fd)
        with contextlib.suppress(OSError):
            tmp.unlink(missing_ok=True)
        raise


def atomic_write_text(path: str | Path, content: str) -> None:
    destination = Path(path)
    _assert_output_location_safe(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    _assert_output_location_safe(destination)
    tmp_path = destination.with_name(f"{destination.name}.{uuid.uuid4().hex}.tmp")
    fd = _open_exclusive_tmp(tmp_path)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            fd = -1
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        _assert_output_location_safe(destination)
        _assert_not_symlink_or_reparse(tmp_path)
        os.replace(tmp_path, destination)
    finally:
        if fd >= 0:
            with contextlib.suppress(OSError):
                os.close(fd)
        tmp_path.unlink(missing_ok=True)


def atomic_write_json(path: str | Path, payload: Any, *, indent: int | None = 2) -> None:
    atomic_write_text(path, json.dumps(payload, ensure_ascii=False, indent=indent))
