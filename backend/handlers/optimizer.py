"""Image optimizer handlers."""
from __future__ import annotations
import base64
import os
import zipfile
from io import BytesIO
from typing import Any
from backend.handlers.common import with_locale

@with_locale
def image_optimizer_zip(params: dict[str, Any]) -> dict[str, str]:
    files = params.get("files", [])
    zip_name = params.get("zip_name", "imagenes_optimizadas")
    if not files:
        raise ValueError("No files provided")
    zip_buffer = BytesIO()
    with zipfile.ZipFile(zip_buffer, mode='w', compression=zipfile.ZIP_DEFLATED) as zip_file:
        for file_info in files:
            filename = file_info.get("filename", "file")
            content_b64 = file_info.get("content_b64", "")
            if not content_b64:
                continue
            zip_file.writestr(os.path.basename(filename), base64.b64decode(content_b64))
    zip_buffer.seek(0)
    safe_zip_name = zip_name.strip().replace(" ", "_")
    if not safe_zip_name.lower().endswith(".zip"):
        safe_zip_name += ".zip"
    return {"zip_base64": base64.b64encode(zip_buffer.read()).decode("ascii"), "filename": safe_zip_name}

HANDLERS = {
    "image_optimizer_zip": image_optimizer_zip,
}
