from __future__ import annotations

import base64
import io
import json
import logging
import math
import os
import shutil
import sys
import threading
import uuid
from pathlib import Path
from typing import Any

from pypdf import PdfReader

from backend.utils.atomic_write import atomic_write_json
from backend.utils.paths import resource_path, user_data_path
from backend.utils.validators import is_safe_user_path, sanitizar_nombre

logger = logging.getLogger(__name__)

MAX_UPLOAD_PDF_BYTES = 50 * 1024 * 1024
MAX_UNCOMPRESSED_RATIO = 100
MAX_UPLOAD_PDF_PAGES = 1000
_FORMATOS_PREVIEW_MIN_DPI = 72

_PROJECT_DIR = Path(__file__).resolve().parent.parent.parent
_BUILTIN_DIR = Path(resource_path("formatos"))
_LEGACY_DATA_DIR = _PROJECT_DIR / "data" / "formatos"
_DATA_DIR = user_data_path("formatos")
_UPLOADS_DIR = _DATA_DIR / "uploads"
_CATALOG_PATH = _DATA_DIR / "catalog.json"


def _migrate_legacy_data_dir() -> None:
    legacy_catalog = _LEGACY_DATA_DIR / "catalog.json"
    if _CATALOG_PATH.exists() or not legacy_catalog.is_file():
        return
    shutil.copy2(legacy_catalog, _CATALOG_PATH)
    legacy_uploads = _LEGACY_DATA_DIR / "uploads"
    if legacy_uploads.is_dir():
        for src in legacy_uploads.iterdir():
            if src.is_file():
                shutil.copy2(src, _UPLOADS_DIR / src.name)
    logger.info("Catálogo de formatos migrado de %s a %s", _LEGACY_DATA_DIR, _DATA_DIR)


try:
    _UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    _migrate_legacy_data_dir()
except Exception:
    logger.exception("No se pudo inicializar el directorio de formatos en datos de usuario")


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
                    new_formats[fid]["enabled"] = raw.get("enabled", True)
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
        atomic_write_json(_CATALOG_PATH, persistable)


def _resolve_path(fmt: dict[str, Any]) -> Path:
    if fmt["origen"] == "uploaded":
        candidate = (_UPLOADS_DIR / str(fmt["storage_path"])).resolve()
        uploads_resolved = _UPLOADS_DIR.resolve()
        try:
            candidate.relative_to(uploads_resolved)
        except ValueError as exc:
            msg = f"storage_path fuera de directorio permitido: {fmt['storage_path']}"
            raise ValueError(msg) from exc
        return candidate

    fname = str(fmt["storage_path"])
    builtin = _BUILTIN_DIR / fname
    if builtin.exists():
        return builtin
    exe_dir = Path(sys.executable).parent.resolve()
    prod_root = (exe_dir.parent / "formatos").resolve()
    prod_path = (prod_root / fname).resolve()
    try:
        prod_path.relative_to(prod_root)
    except ValueError:
        logger.warning("prod_path fuera del directorio formatos esperado: %s", prod_path)
    else:
        if prod_path.exists():
            return prod_path
    return _DATA_DIR / fname


def _load_template_bytes(fmt: dict[str, Any]) -> bytes:
    path = _resolve_path(fmt)
    if not path.exists():
        msg = f"Template no encontrado: {path}"
        raise FileNotFoundError(msg)
    if fmt.get("origen") == "uploaded":
        return path.read_bytes()
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
        is_builtin = entry["origen"] == "builtin"
        if is_builtin:
            entry["enabled"] = False
        else:
            _formats.pop(fmt_id, None)
        if not is_builtin:
            try:
                os.remove(_resolve_path(entry))
            except FileNotFoundError:
                pass
            except OSError:
                logger.exception("Error eliminando archivo de formato %s", fmt_id)
        _save_catalog()
    return True


_MAPPING_POINT_MAX = 20000.0
_MAPPING_PADDING_MAX = 12
_MAPPING_MCID_MAX = 64

# clave: (mínimo, máximo, defecto, es_entero)
_MAPPING_NUMERIC_FIELDS: dict[str, tuple[float, float, float, bool]] = {
    "page": (0, MAX_UPLOAD_PDF_PAGES - 1, 0, True),
    "x": (0, _MAPPING_POINT_MAX, 0, False),
    "y": (0, _MAPPING_POINT_MAX, 0, False),
    "width": (1, _MAPPING_POINT_MAX, 140, False),
    "height": (1, _MAPPING_POINT_MAX, 20, False),
    "font_size": (1, 200, 12, False),
    "color_r": (0, 1, 0, False),
    "color_g": (0, 1, 0, False),
    "color_b": (0, 1, 0, False),
    "padding": (0, _MAPPING_PADDING_MAX, 7, True),
    "blank_x": (0, _MAPPING_POINT_MAX, 0, False),
    "blank_y": (0, _MAPPING_POINT_MAX, 0, False),
    "blank_width": (0, _MAPPING_POINT_MAX, 0, False),
    "blank_height": (0, _MAPPING_POINT_MAX, 0, False),
}


def _coerce_mapping_number(value: object, lo: float, hi: float, default: float, as_int: bool) -> float | int:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        number = default
    else:
        try:
            number = float(value)
        except ValueError:
            number = default
        if not math.isfinite(number):
            number = default
    clamped = min(max(number, lo), hi)
    return round(clamped) if as_int else clamped


def _sanitize_mapping(mapping: object) -> dict[str, object]:
    """Ajusta el mapping que llega del renderer al rango que sus consumidores pueden
    escribir: indexa las páginas del PDF, alimenta el `zfill` del nombre de archivo y
    se interpola en el stream del overlay."""
    if not isinstance(mapping, dict):
        msg = "El mapping debe ser un objeto"
        raise ValueError(msg)
    clean: dict[str, object] = {}
    for key, (lo, hi, default, as_int) in _MAPPING_NUMERIC_FIELDS.items():
        value = mapping.get(key)
        if value is None and key.startswith("blank_"):
            clean[key] = None
        else:
            clean[key] = _coerce_mapping_number(value, lo, hi, default, as_int)
    raw_name = "".join(c for c in str(mapping.get("font_name") or "Helvetica") if c.isalnum() or c in "-+")
    clean["font_name"] = raw_name[:40] or "Helvetica"
    clean["redraw_top_border"] = bool(mapping.get("redraw_top_border"))
    clean["redraw_ot_badge"] = bool(mapping.get("redraw_ot_badge"))
    mcids = mapping.get("blank_mcids")
    clean["blank_mcids"] = (
        [_coerce_mapping_number(m, 0, 1000000, 0, True) for m in list(mcids)[:_MAPPING_MCID_MAX]]
        if isinstance(mcids, (list, tuple))
        else None
    )
    return clean


def update_mapping(fmt_id: str, mapping: dict[str, Any]) -> dict[str, Any] | None:
    with _formats_lock:
        entry = _formats.get(fmt_id)
        if entry is None:
            return None
        entry["mapping"] = _sanitize_mapping(mapping)
        if entry["strategy"] == SIMPLE_OVERLAY:
            entry["strategy"] = VISUAL_OVERLAY
        _save_catalog()
        result = dict(entry)
    result["has_mapping"] = result.get("mapping") is not None
    return result


def add_uploaded_format(
    nombre: str,
    filename: str,
    content: bytes,
    persisted: bool = True,
    filename_pattern: str | None = None,
) -> dict[str, Any]:
    fmt_id = f"upload-{uuid.uuid4().hex[:8]}"
    safe_filename = sanitizar_nombre(filename) or "archivo.pdf"
    if not is_safe_user_path(safe_filename):
        msg = "Nombre de archivo inválido"
        raise ValueError(msg)
    safe_name = f"{fmt_id}_{safe_filename}"
    dest = _UPLOADS_DIR / safe_name
    uploads_resolved = _UPLOADS_DIR.resolve()
    try:
        dest.resolve().relative_to(uploads_resolved)
    except ValueError as exc:
        msg = "Ruta de destino fuera del directorio permitido"
        raise ValueError(msg) from exc

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
        if page_count < 1:
            msg = "El PDF no tiene páginas"
            raise ValueError(msg)
        if page_count > MAX_UPLOAD_PDF_PAGES:
            msg = f"PDF excede el máximo de {MAX_UPLOAD_PDF_PAGES} páginas"
            raise ValueError(msg)

        total_size = 0
        for page in reader.pages:
            contents = page.get_contents() if hasattr(page, "get_contents") else None
            if contents is not None:
                try:
                    raw = contents.get_data()
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


def get_template_pdf(fmt_id: str) -> tuple[bytes, str]:
    entry = get_format(fmt_id)
    if entry is None:
        msg = "Formato no encontrado"
        raise ValueError(msg)
    return _load_template_bytes(entry), entry["nombre"]


def render_template_page(fmt_id: str, page_num: int, max_width: int = 1200) -> dict[str, Any]:
    entry = get_format(fmt_id)
    if entry is None:
        msg = "Formato no encontrado"
        raise ValueError(msg)
    template_bytes = _load_template_bytes(entry)
    from backend.core.sellador_preview import render_pdf_bytes_page_preview
    return render_pdf_bytes_page_preview(
        template_bytes,
        page_num,
        max_width=max_width,
        minimum_dpi=_FORMATOS_PREVIEW_MIN_DPI,
        enforce_max_width=True,
    )


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


_load_catalog()
