from __future__ import annotations

import base64
import binascii
import contextlib
import os
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Any

from backend.handlers.common import with_locale

MAX_DEDUP_ATTEMPTS = 1000


def _safe_name(value: str, fallback: str, *, strict: bool = False) -> str:
    safe = value.strip().replace("\\", "/").split("/")[-1].strip()
    invalid = ':*?"<>|\\/' if strict else ':*?"<>|'
    safe = "".join(
        "-" if char in invalid or (strict and ord(char) < 32) else char for char in safe
    )
    if strict:
        safe = safe.rstrip(" .")
    return safe or fallback


def _safe_filename(value: str, fallback: str) -> str:
    return _safe_name(value, fallback, strict=True)


def _dedupe_archive_name(filename: str, seen: dict[str, int]) -> str:
    stem, dot, extension = filename.rpartition(".")
    if not stem:
        stem = filename
        dot = ""
        extension = ""
    key = filename.lower()
    count = seen.get(key, 0)
    seen[key] = count + 1
    if count == 0:
        return filename
    suffix = f"-{count + 1}"
    return f"{stem}{suffix}{dot}{extension}" if dot else f"{stem}{suffix}"


@with_locale
def image_optimizer_save_files(params: dict[str, Any]) -> dict[str, Any]:
    files = params.get("files", [])
    output_folder = str(params.get("output_folder") or "").strip()
    if not files:
        msg = "No files provided"
        raise ValueError(msg)
    if not output_folder:
        msg = "output_folder is required"
        raise ValueError(msg)

    resolved_folder = str(params.get("_resolved_output_path") or output_folder).strip() or output_folder
    from pathlib import Path as _P
    rf = _P(resolved_folder).expanduser().resolve()
    if rf.is_symlink():
        raise ValueError("symlink no permitido en carpeta de salida")
    destination = rf
    destination.mkdir(parents=True, exist_ok=True)

    seen: dict[str, int] = {}
    saved: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []

    for file_info in files:
        raw_name = str(file_info.get("filename", "") or "archivo")
        content_b64 = str(file_info.get("content_b64", "") or "")
        if not content_b64:
            skipped.append({"filename": raw_name, "reason": "empty_content"})
            continue

        safe_base = _safe_filename(raw_name, "archivo")
        archive_name = _dedupe_archive_name(safe_base, seen)
        target = destination / archive_name

        attempts = 0
        while target.exists() and attempts < MAX_DEDUP_ATTEMPTS:
            archive_name = _dedupe_archive_name(safe_base, seen)
            target = destination / archive_name
            attempts += 1
        if target.exists():
            skipped.append({"filename": safe_base, "reason": "no_free_slot"})
            continue

        fd, tmp_name = tempfile.mkstemp(dir=str(destination), prefix=f".{safe_base}-", suffix=".antares-tmp")
        os.close(fd)
        tmp_target = Path(tmp_name)
        try:
            with tmp_target.open("wb") as out:
                base64.decode(BytesIO(content_b64.encode("ascii")), out)
            try:
                os.rename(tmp_target, target)
            except FileExistsError:
                skipped.append({"filename": archive_name, "reason": "no_free_slot"})
                with contextlib.suppress(OSError):
                    tmp_target.unlink(missing_ok=True)
                continue
            saved.append({"filename": archive_name, "path": str(target)})
        except (OSError, binascii.Error, ValueError) as err:
            skipped.append({"filename": archive_name, "reason": str(err)})
            try:
                if tmp_target.exists():
                    os.remove(tmp_target)
            except OSError:
                pass

    return {
        "saved_path": str(destination),
        "saved_count": len(saved),
        "skipped_count": len(skipped),
        "saved": saved,
        "skipped": skipped,
    }


HANDLERS = {
    "image_optimizer_save_files": image_optimizer_save_files,
}
