"""
Generador de formatos PDF con correlativo.
Adaptado del módulo formatos para IPC backend.

PDF generation is delegated to format_strategies/ modules.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import sys
import threading
import uuid
from pathlib import Path
from typing import Any

from pypdf import PdfReader

logger = logging.getLogger(__name__)

MAX_UPLOAD_PDF_BYTES = 50 * 1024 * 1024
MAX_UNCOMPRESSED_RATIO = 100
MAX_UPLOAD_PDF_PAGES = 1000

_PROJECT_DIR = Path(__file__).resolve().parent.parent.parent
_BUILTIN_DIR = _PROJECT_DIR / "formatos"
_DATA_DIR = _PROJECT_DIR / "data" / "formatos"
_UPLOADS_DIR = _DATA_DIR / "uploads"
_CATALOG_PATH = _DATA_DIR / "catalog.json"

_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
_DATA_DIR.mkdir(parents=True, exist_ok=True)

# ─── Modelos simples (dict-based para IPC serializable) ──────────────────────

# Strategies
# LEGACY_XOBJECT: mantenida para compatibilidad con el template "Formato D (SEDAPAL)"
# que usa un XObject específico del PDF para inyectar el número de correlativo.
# No usar para nuevos formatos — preferir VISUAL_OVERLAY o SIMPLE_OVERLAY.
LEGACY_XOBJECT = "legacy_xobject"
VISUAL_OVERLAY = "visual_overlay"
SIMPLE_OVERLAY = "simple_overlay"

_BUILTIN_FORMATS: list[dict[str, Any]] = [
    {
        "id": "template-d",
        "nombre": "Formato D (SEDAPAL)",
        "origen": "builtin",
        "storage_path": "template-d.b64",
        "enabled": True,
        "persisted": True,
        "strategy": LEGACY_XOBJECT,
        "mapping": None,
        "filename_pattern": "formato_d_{desde}.pdf",
        "max_pages": 500,
        "number_min": 1,
        "number_max": 9999999,
        "has_mapping": False,
    },
    {
        "id": "maquina",
        "nombre": "Máquina",
        "origen": "builtin",
        "storage_path": "maquina.b64",
        "enabled": True,
        "persisted": True,
        "strategy": VISUAL_OVERLAY,
        "mapping": {
            "page": 0, "x": 535, "y": 26, "width": 140, "height": 20,
            "font_size": 13, "font_name": "Helvetica-Bold",
            "color_r": 0.1176, "color_g": 0.2275, "color_b": 0.5412,
            "padding": 5,
            "blank_x": None, "blank_y": None, "blank_width": None, "blank_height": None,
            "redraw_top_border": False, "redraw_ot_badge": False, "blank_mcids": None,
        },
        "filename_pattern": "maquina_{desde}.pdf",
        "max_pages": 500,
        "number_min": 1,
        "number_max": 9999999,
        "has_mapping": True,
    },
    {
        "id": "televisiva",
        "nombre": "Televisiva",
        "origen": "builtin",
        "storage_path": "televisiva.b64",
        "enabled": True,
        "persisted": True,
        "strategy": VISUAL_OVERLAY,
        "mapping": {
            "page": 0, "x": 534, "y": 25, "width": 150, "height": 24,
            "font_size": 15, "font_name": "Helvetica-Bold",
            "color_r": 0.1176, "color_g": 0.2275, "color_b": 0.5412,
            "padding": 5,
            "blank_x": None, "blank_y": None, "blank_width": None, "blank_height": None,
            "redraw_top_border": False, "redraw_ot_badge": False, "blank_mcids": [63],
        },
        "filename_pattern": "televisiva_{desde}.pdf",
        "max_pages": 500,
        "number_min": 1,
        "number_max": 9999999,
        "has_mapping": True,
    },
]

# ─── Catalogo en memoria ────────────────────────────────────────────────────

_formats: dict[str, dict[str, Any]] = {}
_formats_lock = threading.RLock()


def _load_catalog() -> None:
    global _formats
    new_formats: dict[str, dict[str, Any]] = {}
    for fmt in _BUILTIN_FORMATS:
        new_formats[fmt["id"]] = dict(fmt)

    if _CATALOG_PATH.exists():
        try:
            with open(_CATALOG_PATH, encoding="utf-8") as f:
                data = json.load(f)
            for raw in data:
                fid = raw.get("id")
                if "has_mapping" not in raw:
                    raw["has_mapping"] = raw.get("mapping") is not None

                if fid in new_formats and new_formats[fid]["origen"] == "builtin":
                    if raw.get("mapping") is not None:
                        new_formats[fid]["mapping"] = raw["mapping"]
                        new_formats[fid]["has_mapping"] = True
                else:
                    if raw.get("origen") == "uploaded" and raw.get("strategy") == VISUAL_OVERLAY and raw.get("mapping") is None:
                        raw["strategy"] = SIMPLE_OVERLAY
                    new_formats[fid] = raw
        except Exception:
            logger.exception("Error cargando catalogo desde %s", _CATALOG_PATH)
    with _formats_lock:
        _formats = new_formats


def _save_catalog() -> None:
    with _formats_lock:
        persistable = [fmt for fmt in _formats.values() if fmt.get("persisted", True)]
    with open(_CATALOG_PATH, "w", encoding="utf-8") as f:
        json.dump(persistable, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())


def _resolve_path(fmt: dict[str, Any]) -> Path:
    if fmt["origen"] == "uploaded":
        # Sanitize storage_path so it cannot escape the uploads directory
        # (defense in depth — storage_path is created server-side but we
        # still validate before touching the filesystem).
        candidate = (_UPLOADS_DIR / fmt["storage_path"]).resolve()
        uploads_resolved = _UPLOADS_DIR.resolve()
        try:
            candidate.relative_to(uploads_resolved)
        except ValueError as exc:
            msg = f"storage_path fuera de directorio permitido: {fmt['storage_path']}"
            raise ValueError(msg) from exc
        return candidate

    fname = fmt["storage_path"]
    # 1. Development: project root /formatos/
    builtin = _BUILTIN_DIR / fname
    if builtin.exists():
        return builtin
    # 2. Production (electron-builder + PyInstaller):
    #    backend exe is in resources/backend/, extraResources put formatos/ in resources/formatos/
    exe_dir = Path(sys.executable).parent.resolve()
    prod_root = (exe_dir.parent / "formatos").resolve()
    prod_path = (prod_root / fname).resolve()
    # Ensure prod_path actually lives under prod_root (rejects traversal via
    # crafted storage_path or symlink shenanigans).
    try:
        prod_path.relative_to(prod_root)
    except ValueError:
        logger.warning("prod_path fuera del directorio formatos esperado: %s", prod_path)
    else:
        if prod_path.exists():
            return prod_path
    # 3. Fallback to data dir
    return _DATA_DIR / fname


def _load_template_bytes(fmt: dict[str, Any]) -> bytes:
    path = _resolve_path(fmt)
    if not path.exists():
        msg = f"Template no encontrado: {path}"
        raise FileNotFoundError(msg)
    # Uploaded formats are stored as raw PDF binary
    if fmt.get("origen") == "uploaded":
        return path.read_bytes()
    # Built-in formats are stored as .b64 base64 text
    text = path.read_text(encoding="ascii")
    return base64.b64decode(text)


def list_formats() -> list[dict[str, Any]]:
    with _formats_lock:
        snapshots = [dict(f) for f in _formats.values()]
    result = []
    for f in snapshots:
        if not f.get("enabled", True):
            continue
        f["has_mapping"] = f.get("mapping") is not None
        result.append(f)
    return result


def get_format(fmt_id: str) -> dict[str, Any] | None:
    with _formats_lock:
        fmt = _formats.get(fmt_id)
    if fmt:
        result = dict(fmt)
        result["has_mapping"] = result.get("mapping") is not None
        return result
    return None


def delete_format(fmt_id: str) -> bool:
    with _formats_lock:
        entry = _formats.get(fmt_id)
        if entry is None:
            return False
        if entry["origen"] == "builtin":
            entry["enabled"] = False
        else:
            _formats.pop(fmt_id, None)
    try:
        os.remove(_resolve_path(entry))
    except FileNotFoundError:
        pass
    except Exception:
        logger.exception("Error eliminando archivo de formato %s", fmt_id)
    _save_catalog()
    return True


def update_mapping(fmt_id: str, mapping: dict[str, Any]) -> dict[str, Any] | None:
    with _formats_lock:
        entry = _formats.get(fmt_id)
    if entry is None:
        return None
    entry["mapping"] = mapping
    if entry["strategy"] == SIMPLE_OVERLAY:
        entry["strategy"] = VISUAL_OVERLAY
    _save_catalog()
    result = dict(entry)
    result["has_mapping"] = result.get("mapping") is not None
    return result


# ─── Upload ─────────────────────────────────────────────────────────────────

def add_uploaded_format(
    nombre: str,
    filename: str,
    content: bytes,
    persisted: bool = True,
    filename_pattern: str | None = None,
) -> dict[str, Any]:
    fmt_id = f"upload-{uuid.uuid4().hex[:8]}"
    safe_name = f"{fmt_id}_{filename}"
    dest = _UPLOADS_DIR / safe_name

    if len(content) > MAX_UPLOAD_PDF_BYTES:
        msg = "PDF excede tamaño máximo permitido (50 MB)"
        raise ValueError(msg)

    pdf_stream = io.BytesIO(content)
    try:
        reader = PdfReader(pdf_stream)
    except Exception as exc:
        pdf_stream.close()
        msg = f"PDF invalido o corrupto: {exc}"
        raise ValueError(msg) from exc

    try:
        page_count = len(reader.pages)
        if page_count > MAX_UPLOAD_PDF_PAGES:
            msg = f"PDF excede el máximo de {MAX_UPLOAD_PDF_PAGES} páginas"
            raise ValueError(msg)

        total_size = 0
        for page in reader.pages:
            if hasattr(page, "get_contents") and page.get_contents():
                try:
                    raw = page.get_contents().get_data()
                    total_size += len(raw)
                except Exception:
                    pass
            if total_size > MAX_UPLOAD_PDF_BYTES * MAX_UNCOMPRESSED_RATIO:
                msg = "PDF excede el límite de contenido descomprimido"
                raise ValueError(msg)
    finally:
        pdf_stream.close()

    dest.write_bytes(content)

    entry = {
        "id": fmt_id,
        "nombre": nombre,
        "origen": "uploaded",
        "storage_path": safe_name,
        "enabled": True,
        "persisted": persisted,
        "strategy": SIMPLE_OVERLAY,
        "mapping": None,
        "filename_pattern": filename_pattern or f"{fmt_id}_{{desde}}.pdf",
        "max_pages": 500,
        "number_min": 1,
        "number_max": 9999999,
        "has_mapping": False,
    }
    with _formats_lock:
        _formats[fmt_id] = entry
    if persisted:
        _save_catalog()
    return entry


# ─── Generación de PDFs (delegated to format_strategies) ─────────────────────


def generate_pdf(fmt_id: str, desde: int, hasta: int) -> tuple[bytes, str]:
    entry = get_format(fmt_id)
    if entry is None:
        msg = "Formato no encontrado"
        raise ValueError(msg)
    if not entry.get("enabled", True):
        msg = "Formato deshabilitado"
        raise ValueError(msg)
    if desde > hasta:
        msg = "'desde' debe ser menor o igual a 'hasta'"
        raise ValueError(msg)
    total = hasta - desde + 1
    if total > entry["max_pages"]:
        msg = f"Maximo {entry['max_pages']} paginas por solicitud"
        raise ValueError(msg)
    if desde < entry["number_min"] or hasta > entry["number_max"]:
        msg = f"Rango fuera de limites ({entry['number_min']} - {entry['number_max']})"
        raise ValueError(msg)
    if entry["strategy"] == VISUAL_OVERLAY and entry.get("mapping") is None:
        msg = "Este formato requiere configurar el mapping visual antes de generar"
        raise ValueError(msg)

    template_bytes = _load_template_bytes(entry)

    from backend.core.format_strategies import get_strategy
    strategy_impl = get_strategy(entry["strategy"])
    pdf_bytes = strategy_impl.generate(template_bytes, desde, hasta, entry.get("mapping"))

    pad = entry.get("mapping", {}).get("padding", 7) if entry.get("mapping") else 7
    desde_s = str(desde).zfill(pad)
    hasta_s = str(hasta).zfill(pad)
    pattern = entry["filename_pattern"]
    if desde == hasta:
        filename = pattern.format(id=entry["id"], nombre=entry["nombre"], desde=desde_s, hasta=hasta_s)
    else:
        base = pattern.replace(".pdf", "")
        filename = f"{base.format(id=entry['id'], nombre=entry['nombre'], desde=desde_s, hasta=hasta_s)}-{hasta_s}.pdf"
    return pdf_bytes, filename


# ─── Init ───────────────────────────────────────────────────────────────────
_load_catalog()
