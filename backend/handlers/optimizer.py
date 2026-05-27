"""Image optimizer handlers."""
from __future__ import annotations

import base64
import zipfile
from io import BytesIO
from typing import Any

from backend.handlers.common import with_locale


def _safe_name(value: str, fallback: str) -> str:
    safe = value.strip().replace("\\", "/").split("/")[-1].strip()
    safe = "".join("-" if char in ':*?"<>|' else char for char in safe)
    return safe or fallback


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


@with_locale
def image_optimizer_zip(params: dict[str, Any]) -> dict[str, str]:
    files = params.get("files", [])
    zip_name = params.get("zip_name", "imagenes_optimizadas")
    if not files:
        msg = "No files provided"
        raise ValueError(msg)
    safe_zip_name = _safe_zip_filename(str(zip_name))
    safe_folder_name = _safe_zip_folder_name(str(zip_name))
    seen_names: dict[str, int] = {}
    zip_buffer = BytesIO()
    with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zip_file:
        for file_info in files:
            filename = file_info.get("filename", "file")
            content_b64 = file_info.get("content_b64", "")
            if not content_b64:
                continue
            entry_filename = _safe_name(str(filename), "file")
            entry_filename = _dedupe_archive_name(entry_filename, seen_names)
            zip_file.writestr(f"{safe_folder_name}/{entry_filename}", base64.b64decode(content_b64))
    zip_buffer.seek(0)
    return {"zip_base64": base64.b64encode(zip_buffer.read()).decode("ascii"), "filename": safe_zip_name}

HANDLERS = {
    "image_optimizer_zip": image_optimizer_zip,
}
