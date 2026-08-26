"""IPC handlers for the Canvas tool."""

from __future__ import annotations

import contextlib
import json
import logging
import os
from pathlib import Path
from typing import Any

from backend.core import canvas as _canvas_core
from backend.core.exceptions import MemoryPressureError, NotFoundError, ValidationError
from backend.core.scheduler import (
    MEMORY_PRESSURE_RETRY_AFTER_MS,
    MEMORY_PRESSURE_THRESHOLD_MB,
    _available_bytes,
    is_memory_pressure,
)
from backend.handlers.common import validate_params, with_locale
from backend.utils.validators import sanitizar_nombre

logger = logging.getLogger(__name__)


def _spill_file_path(doc_id: str, suffix: str = ".json") -> Path:
    store = _canvas_core.get_canvas_store()
    spill_dir = store.docs_dir.parent / "spill"
    safe_id = Path(str(doc_id)).name or "unknown"
    return spill_dir / f"{safe_id}{suffix}"


def _spill_payload(doc_id: str, payload: dict[str, Any], suffix: str = ".json") -> str | None:
    tmp: Path | None = None
    try:
        final = _spill_file_path(doc_id, suffix)
        spill_dir = final.parent
        spill_dir.mkdir(parents=True, exist_ok=True)
        tmp = final.with_name(f"{final.name}.tmp")
        with tmp.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        tmp.replace(final)
        return str(final)
    except Exception as exc:
        if tmp is not None:
            with contextlib.suppress(OSError):
                tmp.unlink(missing_ok=True)
        logger.warning("canvas spill failed for %s: %s", doc_id, exc)
        return None


def _cleanup_spill(doc_id: str, suffix: str = ".json") -> None:
    try:
        _spill_file_path(doc_id, suffix).unlink(missing_ok=True)
    except OSError as exc:
        logger.warning("canvas spill cleanup failed for %s%s: %s", doc_id, suffix, exc)


def _check_memory_pressure_or_spill(document: dict[str, Any] | None = None, *, context: str = "canvas_save") -> None:
    if not is_memory_pressure():
        return
    available = _available_bytes() or 0
    available_mb = available // (1024 * 1024)
    spill_path: str | None = None
    if isinstance(document, dict):
        doc_id = str(document.get("id") or "unknown")
        spill_path = _spill_payload(doc_id, document, suffix=".json")
        if spill_path:
            logger.warning(
                "canvas memory_pressure spill: context=%s doc_id=%s available_mb=%s spill=%s",
                context,
                Path(doc_id).name,
                available_mb,
                spill_path,
            )
    if spill_path is None:
        logger.warning(
            "canvas memory_pressure: context=%s available_mb=%s < %s — rejecting with retry_after",
            context,
            available_mb,
            MEMORY_PRESSURE_THRESHOLD_MB,
        )
    raise MemoryPressureError(
        f"Memoria baja ({available_mb}MB < {MEMORY_PRESSURE_THRESHOLD_MB}MB): "
        f"reintente en {MEMORY_PRESSURE_RETRY_AFTER_MS}ms",
        details={
            "available_mb": available_mb,
            "threshold_mb": MEMORY_PRESSURE_THRESHOLD_MB,
            "retry_after_ms": MEMORY_PRESSURE_RETRY_AFTER_MS,
            "spill_path": spill_path,
            "context": context,
        },
    )


def _check_history_memory_pressure(doc_id: str, past: Any, future: Any) -> None:
    if not is_memory_pressure():
        return
    available = _available_bytes() or 0
    available_mb = available // (1024 * 1024)
    spill_path = _spill_payload(str(doc_id), {"past": past, "future": future}, suffix="_history.json")
    if spill_path:
        logger.warning(
            "canvas history memory_pressure spill: doc_id=%s available_mb=%s spill=%s",
            Path(str(doc_id)).name,
            available_mb,
            spill_path,
        )
    raise MemoryPressureError(
        f"Memoria baja ({available_mb}MB < {MEMORY_PRESSURE_THRESHOLD_MB}MB): "
        f"historial en espera, reintente en {MEMORY_PRESSURE_RETRY_AFTER_MS}ms",
        details={
            "available_mb": available_mb,
            "threshold_mb": MEMORY_PRESSURE_THRESHOLD_MB,
            "retry_after_ms": MEMORY_PRESSURE_RETRY_AFTER_MS,
            "spill_path": spill_path,
            "context": "canvas_save_history",
        },
    )

@with_locale
def canvas_list(params: dict[str, Any]) -> dict[str, Any]:
    return {"documents": _canvas_core.get_canvas_store().list_documents()}


@with_locale
@validate_params("id")
def canvas_get(params: dict[str, Any]) -> dict[str, Any]:
    doc_id = str(params["id"])
    document = _canvas_core.get_canvas_store().get(doc_id)
    if document is None:
        raise NotFoundError("Documento no encontrado")
    return {"document": document}


@with_locale
@validate_params("document")
def canvas_save(params: dict[str, Any]) -> dict[str, Any]:
    document = params["document"]
    if not isinstance(document, dict):
        raise ValidationError("document debe ser un objeto")
    _check_memory_pressure_or_spill(document, context="canvas_save")
    touch = params.get("touch", True)
    if not isinstance(touch, bool):
        touch = True
    saved = _canvas_core.get_canvas_store().save(document, touch=touch)
    _cleanup_spill(str(document.get("id") or "unknown"))
    return {"document": saved}

@with_locale
def canvas_create(params: dict[str, Any]) -> dict[str, Any]:
    name = str(params.get("name") or "Sin título")
    document = _canvas_core.get_canvas_store().create(name=name)
    return {"document": document}


@with_locale
@validate_params("id")
def canvas_delete(params: dict[str, Any]) -> dict[str, Any]:
    doc_id = str(params["id"])
    try:
        deleted = _canvas_core.get_canvas_store().delete(doc_id)
    finally:
        _cleanup_spill(doc_id)
        _cleanup_spill(doc_id, "_history.json")
    if not deleted:
        raise NotFoundError("Documento no encontrado")
    return {"success": True, "deleted_id": doc_id}


@with_locale
@validate_params("id")
def canvas_duplicate(params: dict[str, Any]) -> dict[str, Any]:
    doc_id = str(params["id"])
    name = params.get("name")
    document = _canvas_core.get_canvas_store().duplicate(doc_id, name=str(name) if name else None)
    return {"document": document}


_MAX_INLINE_PDF_BYTES = 40 * 1024 * 1024


@with_locale
@validate_params("document")
def canvas_export_cmyk_pdf(params: dict[str, Any]) -> dict[str, Any]:
    import base64
    import uuid

    from backend.core.cmyk_pdf import CanvasCmykRenderer
    from backend.utils.paths import user_data_path

    document = params["document"]
    contexts = params.get("contexts") or []
    color_profile = str(params.get("color_profile") or "cmyk_iso_coated_v2")
    dpi = int(params.get("dpi") or 300)
    bleed_mm = float(params.get("bleed_mm") or 0.0)
    show_crop_marks = bool(params.get("show_crop_marks", False))
    pair_context_pages = bool(params.get("pair_context_pages", False))
    filename = str(params.get("filename") or "canvas_cmyk.pdf")
    output_path = params.get("outputPath")
    local_image_paths = params.get("localImagePaths") or {}

    renderer = CanvasCmykRenderer(
        document=document,
        contexts=contexts,
        color_profile=color_profile,
        dpi=dpi,
        bleed_mm=bleed_mm,
        show_crop_marks=show_crop_marks,
        pair_context_pages=pair_context_pages,
    )
    pdf_bytes = renderer.render(local_image_paths=local_image_paths)

    if output_path:
        resolved = str(params.get("_resolved_output_path") or output_path).strip()
        safe = sanitizar_nombre(Path(resolved).name) or Path(resolved).name
        if not safe.lower().endswith(".pdf"):
            safe += ".pdf"
        out = Path(resolved).parent / safe
        if out.is_symlink() or out.parent.is_symlink():
            raise ValueError("symlink no permitido en ruta de salida")
        out.parent.mkdir(parents=True, exist_ok=True)
        if out.exists():
            raise FileExistsError(f"El archivo ya existe: {out}")
        tmp = out.with_suffix(out.suffix + ".tmp")
        tmp.write_bytes(pdf_bytes)
        os.replace(tmp, out)
        return {
            "filename": out.name,
            "saved_path": str(out),
        }

    if len(pdf_bytes) > _MAX_INLINE_PDF_BYTES:
        out_dir = user_data_path("canvas/out")
        out_dir.mkdir(parents=True, exist_ok=True)
        tmp_out = out_dir / f"{uuid.uuid4().hex[:12]}_{filename}"
        tmp_out.write_bytes(pdf_bytes)
        return {
            "filename": filename,
            "saved_path": str(tmp_out),
        }

    encoded = base64.b64encode(pdf_bytes).decode("ascii")
    return {
        "filename": filename,
        "pdf_base64": encoded,
    }


@with_locale
@validate_params("id")
def canvas_get_history(params: dict[str, Any]) -> dict[str, Any]:
    doc_id = str(params["id"])
    history_data = _canvas_core.get_canvas_store().get_history(doc_id)
    return history_data


@with_locale
@validate_params("id")
def canvas_save_history(params: dict[str, Any]) -> dict[str, Any]:
    doc_id = str(params["id"])
    past = params.get("past") or []
    future = params.get("future") or []
    if not isinstance(past, list) or not isinstance(future, list):
        msg = "past and future must be arrays"
        raise ValueError(msg)
    _check_history_memory_pressure(doc_id, past, future)
    _canvas_core.get_canvas_store().save_history(doc_id, past, future)
    _cleanup_spill(doc_id, "_history.json")
    return {"success": True}

HANDLERS = {
    "canvas_list": canvas_list,
    "canvas_get": canvas_get,
    "canvas_save": canvas_save,
    "canvas_create": canvas_create,
    "canvas_delete": canvas_delete,
    "canvas_duplicate": canvas_duplicate,
    "canvas_export_cmyk_pdf": canvas_export_cmyk_pdf,
    "canvas_get_history": canvas_get_history,
    "canvas_save_history": canvas_save_history,
}

