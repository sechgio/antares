"""Image optimizer handlers."""
from __future__ import annotations

import base64
import binascii
import os
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Any

from backend.handlers.common import with_locale

# Cap on how many on-disk collisions we walk past before giving up on a file.
# Without it, a destination folder pre-populated with foto.jpg..foto-999.jpg
# would make the dedup loop iterate ~999 times per colliding file. 1000 is far
# above any realistic batch and turns a potential hang into a skipped file.
MAX_DEDUP_ATTEMPTS = 1000


def _safe_name(value: str, fallback: str, *, strict: bool = False) -> str:
    """Sanitize a basename, collapsing invalid chars to ``-``.

    When ``strict`` is False (used for zip/archive entry names) only the
    Windows-invalid set ``:*?"<>|`` is collapsed and the value is returned
    as-is (minus a leading basename extraction).

    When ``strict`` is True (used for writing files to disk via
    ``image_optimizer_save_files``) the path separators ``\\/`` and control
    characters (``ord < 32``) are also collapsed and trailing spaces/dots are
    stripped — so the renderer cannot write outside the chosen destination
    folder nor craft reserved names.
    """
    safe = value.strip().replace("\\", "/").split("/")[-1].strip()
    invalid = ':*?"<>|\\/' if strict else ':*?"<>|'
    safe = "".join(
        "-" if char in invalid or (strict and ord(char) < 32) else char for char in safe
    )
    if strict:
        safe = safe.rstrip(" .")
    return safe or fallback


def _safe_filename(value: str, fallback: str) -> str:
    """Strict basename sanitisation for writing to disk — see ``_safe_name``."""
    return _safe_name(value, fallback, strict=True)


def _safe_zip_filename(value: str) -> str:
    safe = _safe_name(value, "imagenes_optimizadas").replace(" ", "_")
    if not safe.lower().endswith(".zip"):
        safe += ".zip"
    return safe


def _safe_zip_folder_name(zip_filename: str) -> str:
    safe = _safe_zip_filename(zip_filename)
    return safe[:-4] if safe.lower().endswith(".zip") else safe


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


def _write_b64_zip_entry(zip_file: zipfile.ZipFile, archive_name: str, content_b64: str) -> None:
    with zip_file.open(archive_name, "w") as target:
        base64.decode(BytesIO(content_b64.encode("ascii")), target)


def _write_optimizer_zip(files: list[dict[str, Any]], zip_name: str, target: BytesIO | Path) -> str:
    safe_zip_name = _safe_zip_filename(str(zip_name))
    safe_folder_name = _safe_zip_folder_name(str(zip_name))
    seen_names: dict[str, int] = {}
    with zipfile.ZipFile(target, mode="w", compression=zipfile.ZIP_DEFLATED) as zip_file:
        for file_info in files:
            filename = file_info.get("filename", "file")
            content_b64 = file_info.get("content_b64", "")
            if not content_b64:
                continue
            entry_filename = _safe_name(str(filename), "file")
            entry_filename = _dedupe_archive_name(entry_filename, seen_names)
            _write_b64_zip_entry(zip_file, f"{safe_folder_name}/{entry_filename}", str(content_b64))
    return safe_zip_name


@with_locale
def image_optimizer_zip(params: dict[str, Any]) -> dict[str, str]:
    files = params.get("files", [])
    zip_name = params.get("zip_name", "imagenes_optimizadas")
    if not files:
        msg = "No files provided"
        raise ValueError(msg)
    output_path = str(params.get("output_path") or "").strip()
    if output_path:
        destination = Path(output_path).expanduser().resolve()
        if destination.suffix.lower() != ".zip":
            destination = destination.with_suffix(".zip")
        destination.parent.mkdir(parents=True, exist_ok=True)
        _write_optimizer_zip(files, str(zip_name), destination)
        return {"saved_path": str(destination), "filename": destination.name}

    zip_buffer = BytesIO()
    safe_zip_name = _write_optimizer_zip(files, str(zip_name), zip_buffer)
    zip_buffer.seek(0)
    return {"zip_base64": base64.b64encode(zip_buffer.read()).decode("ascii"), "filename": safe_zip_name}


@with_locale
def image_optimizer_save_files(params: dict[str, Any]) -> dict[str, Any]:
    """Write optimized images directly to a user-chosen output folder.

    Skips the browser download queue entirely, which is the only reliable
    way to save large batches (>20 files) without the browser blocking
    subsequent downloads. Filenames are sanitized to the destination folder
    and deduplicated so existing files are never overwritten silently.
    """
    files = params.get("files", [])
    output_folder = str(params.get("output_folder") or "").strip()
    if not files:
        msg = "No files provided"
        raise ValueError(msg)
    if not output_folder:
        msg = "output_folder is required"
        raise ValueError(msg)

    destination = Path(output_folder).expanduser().resolve()
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

        # Defensive guard: _dedupe_archive_name already prevents collisions
        # inside this call, but a file with the same name may pre-exist on
        # disk from a previous run. Loop until we find a name that's free
        # both in `seen` and on disk — a single retry is not enough when
        # multiple deduped files (foto.jpg, foto-2.jpg, ...) already exist.
        # The loop is bounded: if thousands of colliding files already occupy
        # the folder, we skip instead of iterating indefinitely.
        attempts = 0
        while target.exists() and attempts < MAX_DEDUP_ATTEMPTS:
            archive_name = _dedupe_archive_name(safe_base, seen)
            target = destination / archive_name
            attempts += 1
        if target.exists():
            skipped.append({"filename": safe_base, "reason": "no_free_slot"})
            continue

        # Define tmp_target before the try block so the except handler can
        # safely reference it even if the open() call itself fails before
        # assignment (defensive — with_suffix won't fail on a sanitized name
        # but the guard costs nothing and avoids UnboundLocalError).
        tmp_target = target.with_suffix(target.suffix + ".antares-tmp")
        try:
            # Write to a sibling temp file first and only move into place
            # once the base64 decode completes successfully. Otherwise
            # `target.open("wb")` creates an empty/partial file before
            # the malformed payload throws, leaving junk on disk that
            # later runs would dedupe around.
            with tmp_target.open("wb") as out:
                base64.decode(BytesIO(content_b64.encode("ascii")), out)
            os.replace(tmp_target, target)
            saved.append({"filename": archive_name, "path": str(target)})
        except (OSError, binascii.Error, ValueError) as err:
            # binascii.Error (sub-class of ValueError) is raised when
            # content_b64 is malformed; without this catch the whole batch
            # dies mid-flight leaving partial files on disk and no report
            # for the frontend.
            skipped.append({"filename": archive_name, "reason": str(err)})
            # Clean up the temp file if it was created before the failure
            # so we don't leak .antares-tmp files across runs.
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
    "image_optimizer_zip": image_optimizer_zip,
    "image_optimizer_save_files": image_optimizer_save_files,
}
