from __future__ import annotations

import contextlib
import logging
import threading
import uuid
from pathlib import Path
from typing import Any

from backend.core import canvas as _canvas_core
from backend.core.canvas.store import (
    DOCUMENT_SPILL_PREFIX,
    HISTORY_SPILL_PREFIX,
    MAX_CANVAS_DOCUMENT_BYTES,
    MAX_CANVAS_HISTORY_BYTES,
    CanvasDocumentTooLargeError,
    encode_canvas_json,
)
from backend.core.exceptions import MemoryPressureError, NotFoundError, ValidationError
from backend.core.observability import log_event
from backend.core.scheduler import (
    MEMORY_PRESSURE_RETRY_AFTER_MS,
    MEMORY_PRESSURE_THRESHOLD_MB,
    _available_bytes,
    is_memory_pressure,
)
from backend.handlers.common import validate_params, with_locale
from backend.utils.atomic_write import atomic_output_file
from backend.utils.validators import sanitizar_nombre

logger = logging.getLogger(__name__)

_spill_replace_lock = threading.Lock()


def _spill_file_path(doc_id: str, suffix: str = ".json") -> Path:
    store = _canvas_core.get_canvas_store()
    spill_dir = store.docs_dir.parent / "spill"
    safe_id = Path(str(doc_id)).name or "unknown"
    prefix = HISTORY_SPILL_PREFIX if suffix == "_history.json" else DOCUMENT_SPILL_PREFIX
    return spill_dir / f"{prefix}{safe_id}.json"


def _legacy_spill_file_path(doc_id: str, suffix: str = ".json") -> Path:
    store = _canvas_core.get_canvas_store()
    spill_dir = store.docs_dir.parent / "spill"
    safe_id = Path(str(doc_id)).name or "unknown"
    return spill_dir / f"{safe_id}{suffix}"


def _spill_payload(doc_id: str, payload: dict[str, Any], suffix: str = ".json") -> str | None:
    tmp: Path | None = None
    try:
        max_bytes = MAX_CANVAS_HISTORY_BYTES if suffix == "_history.json" else MAX_CANVAS_DOCUMENT_BYTES
        encoded = encode_canvas_json(payload)
        if len(encoded) > max_bytes:
            log_event(
                logger,
                logging.WARNING,
                "canvas.spill_rejected",
                outcome="rejected",
                bytes=len(encoded),
                message=f"canvas spill rejected above storage budget: doc_id={Path(str(doc_id)).name} suffix={suffix} bytes={len(encoded)} max={max_bytes}",
            )
            return None
        final = _spill_file_path(doc_id, suffix)
        spill_dir = final.parent
        spill_dir.mkdir(parents=True, exist_ok=True)
        tmp = final.with_name(f"{final.name}.{uuid.uuid4().hex}.tmp")
        tmp.write_bytes(encoded)
        # Windows cannot reliably replace the same path from concurrent callbacks.
        with _spill_replace_lock:
            tmp.replace(final)
        return str(final)
    except Exception as exc:
        if tmp is not None:
            with contextlib.suppress(OSError):
                tmp.unlink(missing_ok=True)
        log_event(
            logger,
            logging.WARNING,
            "canvas.spill_failed",
            outcome="failed",
            message=f"canvas spill failed for {doc_id}: {exc}",
        )
        return None


def _cleanup_spill(doc_id: str, suffix: str = ".json") -> None:
    for path in {_spill_file_path(doc_id, suffix), _legacy_spill_file_path(doc_id, suffix)}:
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:
            log_event(
                logger,
                logging.WARNING,
                "canvas.spill_cleanup_failed",
                outcome="failed",
                message=f"canvas spill cleanup failed for {doc_id}{suffix}: {exc}",
            )


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
            log_event(
                logger,
                logging.WARNING,
                "canvas.memory_pressure_spill",
                outcome="degraded",
                message=f"canvas memory_pressure spill: context={context} doc_id={Path(doc_id).name} available_mb={available_mb}",
            )
    if spill_path is None:
        log_event(
            logger,
            logging.WARNING,
            "canvas.memory_pressure_rejected",
            outcome="rejected",
            message=f"canvas memory_pressure: context={context} available_mb={available_mb} < {MEMORY_PRESSURE_THRESHOLD_MB}",
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
        log_event(
            logger,
            logging.WARNING,
            "canvas.history_memory_pressure_spill",
            outcome="degraded",
            message=f"canvas history memory_pressure spill: doc_id={Path(str(doc_id)).name} available_mb={available_mb}",
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
def canvas_bootstrap(params: dict[str, Any]) -> dict[str, Any]:
    store = _canvas_core.get_canvas_store()
    documents = store.list_documents()
    # El listado viene ordenado por stem (uuid): bootstrap debe reabrir el
    # documento editado más recientemente, no el primero por nombre.
    latest = max(documents, key=lambda d: d.get("updatedAt") or "", default=None)
    document = store.get(str(latest["id"])) if latest else None
    return {"documents": documents, "document": document}


@with_locale
@validate_params("id")
def canvas_get(params: dict[str, Any]) -> dict[str, Any]:
    doc_id = str(params["id"])
    document = _canvas_core.get_canvas_store().get(doc_id)
    if document is None:
        raise NotFoundError("Documento no encontrado")
    return {"document": document}


def _document_meta(document: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": document.get("id"),
        "name": document.get("name"),
        "updatedAt": document.get("updatedAt"),
        "version": document.get("version"),
        "page": document.get("page"),
        "pages": document.get("pages"),
    }


@with_locale
@validate_params("document")
def canvas_save(params: dict[str, Any]) -> dict[str, Any]:
    document = params["document"]
    if not isinstance(document, dict):
        raise ValidationError("document debe ser un objeto")
    # CanvasStore validates the serialized document without encoding it twice.
    _check_memory_pressure_or_spill(document, context="canvas_save")
    touch = params.get("touch", True)
    if not isinstance(touch, bool):
        touch = True
    try:
        saved = _canvas_core.get_canvas_store().save(document, touch=touch)
    except ValueError as exc:
        details = None
        if isinstance(exc, CanvasDocumentTooLargeError):
            details = {"limit_bytes": MAX_CANVAS_DOCUMENT_BYTES}
        raise ValidationError(str(exc), details=details) from exc
    _cleanup_spill(str(document.get("id") or "unknown"))
    if params.get("slim"):
        # Avoid echoing a multi-MB document back over IPC; the caller already
        # holds the serialized document and only needs backend-stamped meta.
        return {"document": _document_meta(saved), "slim": True}
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

    from backend.core.canvas.models import normalize_document
    from backend.core.cmyk_pdf.renderer import CanvasCmykRenderer
    from backend.utils.paths import user_data_path

    document = normalize_document(params["document"])
    contexts = params.get("contexts") or []
    if not isinstance(contexts, list):
        contexts = []
    if len(contexts) > 50:
        raise ValueError("Demasiados contextos (máx 50)")
    pages = document.get("pages") or []
    pair_context_pages = bool(params.get("pair_context_pages", False))
    # Misma condición que usa CanvasCmykRenderer.render: pareado se emite una
    # página por contexto, si no el producto contexto x página.
    if pair_context_pages and len(contexts) == len(pages):
        output_pages = len(pages)
    else:
        output_pages = len(contexts) * max(1, len(pages))
    if output_pages > 200:
        raise ValueError("Demasiadas páginas a exportar (máx 200)")
    if isinstance(params.get("localImagePaths"), dict) and len(params["localImagePaths"]) > 64:
        raise ValueError("Demasiadas imágenes locales (máx 64)")
    if isinstance(params.get("localImagePaths"), dict) and not all(
        isinstance(k, str) and isinstance(v, str) and v
        for k, v in params["localImagePaths"].items()
    ):
        raise ValueError("localImagePaths debe ser un mapa de token a ruta")
    color_profile = str(params.get("color_profile") or "cmyk_iso_coated_v2")
    dpi = int(params.get("dpi") or 300)
    bleed_mm = float(params.get("bleed_mm") or 0.0)
    show_crop_marks = bool(params.get("show_crop_marks", False))
    canvas_manifest_b64 = params.get("canvas_manifest_b64")
    filename = sanitizar_nombre(Path(str(params.get("filename") or "canvas_cmyk.pdf")).name) or "canvas_cmyk.pdf"
    if not filename.lower().endswith(".pdf"):
        filename += ".pdf"
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
        canvas_manifest_b64=canvas_manifest_b64,
    )
    pdf_bytes = renderer.render(local_image_paths=local_image_paths)

    if output_path:
        resolved = str(params.get("_resolved_output_path") or output_path).strip()
        with atomic_output_file(
            resolved,
            extension=".pdf",
            overwrite=True,
            write_token=params.get("_write_token"),
        ) as target:
            target.tmp_path.write_bytes(pdf_bytes)
        out = target.destination
        return {
            "filename": out.name,
            "saved_path": str(out),
        }

    if len(pdf_bytes) > _MAX_INLINE_PDF_BYTES:
        out_dir = user_data_path("canvas/out")
        out_dir.mkdir(parents=True, exist_ok=True)
        safe_filename = sanitizar_nombre(Path(filename).name) or "canvas_cmyk.pdf"
        tmp_out = out_dir / f"{uuid.uuid4().hex[:12]}_{safe_filename}"
        tmp_out.write_bytes(pdf_bytes)
        return {
            "filename": safe_filename,
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
    # CanvasStore validates retained history without encoding it twice.
    _check_history_memory_pressure(doc_id, past, future)
    store = _canvas_core.get_canvas_store()
    try:
        if "base_digest" in params or "past_prefix" in params or "future_prefix" in params:
            past_prefix = params.get("past_prefix")
            future_prefix = params.get("future_prefix")
            base_digest = params.get("base_digest")
            if not isinstance(past_prefix, int) or not isinstance(future_prefix, int) or not isinstance(base_digest, str):
                raise ValueError("Delta de historial Canvas inválido")
            store.save_history_delta(
                doc_id,
                past_prefix=past_prefix,
                past_suffix=past,
                future_prefix=future_prefix,
                future_suffix=future,
                base_digest=base_digest,
            )
        else:
            store.save_history(doc_id, past, future)
    except ValueError as exc:
        raise ValidationError(str(exc), details={"limit_bytes": MAX_CANVAS_HISTORY_BYTES}) from exc
    _cleanup_spill(doc_id, "_history.json")
    result: dict[str, Any] = {"success": True}  # allowlist: dict[str, Any]
    if params.get("include_digest") is True or "base_digest" in params:
        result["digest"] = store.get_history_digest(doc_id)
    return result

HANDLERS = {
    "canvas_list": canvas_list,
    "canvas_bootstrap": canvas_bootstrap,
    "canvas_get": canvas_get,
    "canvas_save": canvas_save,
    "canvas_create": canvas_create,
    "canvas_delete": canvas_delete,
    "canvas_duplicate": canvas_duplicate,
    "canvas_export_cmyk_pdf": canvas_export_cmyk_pdf,
    "canvas_get_history": canvas_get_history,
    "canvas_save_history": canvas_save_history,
}
