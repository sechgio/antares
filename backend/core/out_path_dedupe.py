from __future__ import annotations

import logging
import os
import threading
from collections import OrderedDict
from collections.abc import Callable
from pathlib import Path

from backend.core.jobs import get_job_manager

logger = logging.getLogger(__name__)

_dest_scan_cache: OrderedDict[str, tuple[float, set[str]]] = OrderedDict()
_dest_scan_lock = threading.Lock()
_MAX_DEST_SCAN_CACHE = 32
_MAX_DEST_SCAN_ENTRIES = 100_000


def _scan_dest_out_keys(destino: str | Path) -> set[str] | None:
    dest = Path(destino)
    try:
        dir_mtime = dest.stat().st_mtime if dest.is_dir() else 0.0
        cache_key = str(dest.resolve()) if dest.is_dir() else str(dest)
        with _dest_scan_lock:
            cached = _dest_scan_cache.get(cache_key)
            if cached and cached[0] == dir_mtime:
                _dest_scan_cache.move_to_end(cache_key)
                return set(cached[1])
    except OSError:
        dir_mtime = 0.0
        cache_key = str(dest)
    keys: set[str] = set()
    try:
        with os.scandir(dest) as entries:
            for index, entry in enumerate(entries, start=1):
                if index > _MAX_DEST_SCAN_ENTRIES:
                    logger.debug(
                        "scandir entry cap reached for destino=%s; falling back to exists()",
                        dest,
                    )
                    return None
                keys.add(_out_path_key(dest / entry.name))
    except FileNotFoundError:
        pass
    except OSError:
        logger.debug("scandir failed for destino=%s; falling back to exists()", dest, exc_info=True)
        return None
    with _dest_scan_lock:
        _dest_scan_cache[cache_key] = (dir_mtime, set(keys))
        _dest_scan_cache.move_to_end(cache_key)
        while len(_dest_scan_cache) > _MAX_DEST_SCAN_CACHE:
            _dest_scan_cache.popitem(last=False)
    return keys


def _out_path_key(path: Path) -> str:
    return str(path).replace("\\", "/").casefold()


_MAX_OUT_PATH_DEDUP_ATTEMPTS = 10_000


def _claim_out_path(
    path: Path,
    reserved: set[str],
    *,
    job_id: str | None = None,
    disk_keys: set[str] | None = None,
) -> bool:
    key = _out_path_key(path)
    if key in reserved:
        return False
    if disk_keys is not None:
        if key in disk_keys:
            return False
    elif path.exists():
        return False
    if job_id is not None and not get_job_manager().try_reserve_out_path(job_id, key):
        return False
    reserved.add(key)
    if disk_keys is not None:
        disk_keys.add(key)
    return True


def _dedupe_chunk_out_paths(
    tasks: list[tuple[str, Path, bool]],
    reserved: set[str],
    *,
    job_id: str | None = None,
    log: Callable[[str], None] | None = None,
    disk_keys: set[str] | None = None,
) -> list[tuple[str, Path, bool]]:
    if not tasks:
        return tasks

    result: list[tuple[str, Path, bool]] = []
    for fpath, out_path, is_video_file in tasks:
        if _claim_out_path(out_path, reserved, job_id=job_id, disk_keys=disk_keys):
            result.append((fpath, out_path, is_video_file))
            continue

        stem = out_path.stem
        suffix = out_path.suffix
        parent = out_path.parent
        n = 2
        candidate = parent / f"{stem}-{n}{suffix}"
        attempts = 0
        claimed = False
        while attempts < _MAX_OUT_PATH_DEDUP_ATTEMPTS:
            if _claim_out_path(candidate, reserved, job_id=job_id, disk_keys=disk_keys):
                claimed = True
                break
            n += 1
            attempts += 1
            candidate = parent / f"{stem}-{n}{suffix}"
        if not claimed:
            key = _out_path_key(candidate)
            reserved.add(key)
            if disk_keys is not None:
                disk_keys.add(key)
            if job_id is not None:
                get_job_manager().try_reserve_out_path(job_id, key)
        if log is not None:
            reason = "ya existe en disco" if out_path.exists() else "ya reservado"
            log(
                f"Colisión de salida: '{out_path.name}' {reason}; "
                f"'{Path(fpath).name}' se guardará como '{candidate.name}'"
            )
        result.append((fpath, candidate, is_video_file))
    return result
