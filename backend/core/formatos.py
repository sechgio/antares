"""
Generador de formatos PDF con correlativo.
Adaptado del módulo formatos para IPC backend.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
import sys
import uuid
from pathlib import Path
from typing import Any

from pypdf import PdfReader, PdfWriter
from pypdf.generic import DictionaryObject, IndirectObject, NameObject, create_string_object

logger = logging.getLogger(__name__)

# Rutas
_PROJECT_DIR = Path(__file__).resolve().parent.parent.parent
_BUILTIN_DIR = _PROJECT_DIR / "formatos"
_DATA_DIR = _PROJECT_DIR / "data" / "formatos"
_UPLOADS_DIR = _DATA_DIR / "uploads"
_CATALOG_PATH = _DATA_DIR / "catalog.json"

# Ensure dirs exist
_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
_DATA_DIR.mkdir(parents=True, exist_ok=True)

# ─── Modelos simples (dict-based para IPC serializable) ──────────────────────

# Strategies
LEGACY_XOBJECT = "legacy_xobject"
VISUAL_OVERLAY = "visual_overlay"
SIMPLE_OVERLAY = "simple_overlay"

# Formatos builtin (serializables como dict)
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


def _load_catalog() -> None:
    global _formats
    _formats = {}
    for fmt in _BUILTIN_FORMATS:
        _formats[fmt["id"]] = dict(fmt)

    if _CATALOG_PATH.exists():
        try:
            with open(_CATALOG_PATH, encoding="utf-8") as f:
                data = json.load(f)
            for raw in data:
                fid = raw.get("id")
                # Ensure has_mapping field is present
                if "has_mapping" not in raw:
                    raw["has_mapping"] = raw.get("mapping") is not None

                if fid in _formats and _formats[fid]["origen"] == "builtin":
                    # Merge uploaded mapping into builtin if present
                    if raw.get("mapping") is not None:
                        _formats[fid]["mapping"] = raw["mapping"]
                        _formats[fid]["has_mapping"] = True
                else:
                    if raw.get("origen") == "uploaded" and raw.get("strategy") == VISUAL_OVERLAY and raw.get("mapping") is None:
                        raw["strategy"] = SIMPLE_OVERLAY
                    _formats[fid] = raw
        except Exception:
            logger.exception("Error cargando catalogo desde %s", _CATALOG_PATH)


def _save_catalog() -> None:
    persistable = [fmt for fmt in _formats.values() if fmt.get("persisted", True)]
    with open(_CATALOG_PATH, "w", encoding="utf-8") as f:
        json.dump(persistable, f, ensure_ascii=False, indent=2)
    f.flush()
    os.fsync(f.fileno())


def _resolve_path(fmt: dict[str, Any]) -> Path:
    if fmt["origen"] == "uploaded":
        return _UPLOADS_DIR / fmt["storage_path"]
    fname = fmt["storage_path"]
    # 1. Development: project root /formatos/
    builtin = _BUILTIN_DIR / fname
    if builtin.exists():
        return builtin
    # 2. Production (electron-builder + PyInstaller):
    #    backend exe is in resources/backend/, extraResources put formatos/ in resources/formatos/
    exe_dir = Path(sys.executable).parent.resolve()
    prod_path = (exe_dir.parent / "formatos" / fname).resolve()
    if prod_path.exists():
        return prod_path
    # 3. Fallback to data dir
    return _DATA_DIR / fname


def _load_template_bytes(fmt: dict[str, Any]) -> bytes:
    path = _resolve_path(fmt)
    if not path.exists():
        raise FileNotFoundError(f"Template no encontrado: {path}")
    # Uploaded formats are stored as raw PDF binary
    if fmt.get("origen") == "uploaded":
        return path.read_bytes()
    # Built-in formats are stored as .b64 base64 text
    text = path.read_text(encoding="ascii")
    return base64.b64decode(text)


def list_formats() -> list[dict[str, Any]]:
    result = []
    for f in _formats.values():
        if not f.get("enabled", True):
            continue
        # Add has_mapping field for frontend compatibility
        fmt = dict(f)
        fmt["has_mapping"] = fmt.get("mapping") is not None
        result.append(fmt)
    return result


def get_format(fmt_id: str) -> dict[str, Any] | None:
    fmt = _formats.get(fmt_id)
    if fmt:
        result = dict(fmt)
        result["has_mapping"] = result.get("mapping") is not None
        return result
    return None


def delete_format(fmt_id: str) -> bool:
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
    entry = _formats.get(fmt_id)
    if entry is None:
        return None
    entry["mapping"] = mapping
    if entry["strategy"] == SIMPLE_OVERLAY:
        entry["strategy"] = VISUAL_OVERLAY
    _save_catalog()
    # Return with has_mapping field
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

    # Validate PDF
    try:
        PdfReader(io.BytesIO(content))
    except Exception as exc:
        raise ValueError(f"PDF invalido o corrupto: {exc}") from exc

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
    _formats[fmt_id] = entry
    if persisted:
        _save_catalog()
    return entry


# ─── Generación de PDFs ─────────────────────────────────────────────────────

_NUMBER_XOBJECT_DRAW_COUNT = 7
_NUMBER_XOBJECT_MARKERS = (
    b"3.7440772 0 0 3.7440772",
    b"1 0 0 rg",
    b"/H2 <</MCID 93 >> BDC",
)
_NUMBER_FONT_NAME = "/FZD"
_NUMBER_FONT_SIZE = 10.6599998
_TEMPLATE_NUMBER_TEXT = "0000001"


def _escape_pdf_text(value: str) -> str:
    """Escape text for PDF Tj operator using WinAnsiEncoding-compatible characters."""
    safe = value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    # Replace chars that WinAnsiEncoding may not have with safe ASCII equivalents
    safe = safe.replace(chr(0x00E1), "a")   # á
    safe = safe.replace(chr(0x00E9), "e")   # é
    safe = safe.replace(chr(0x00ED), "i")   # í
    safe = safe.replace(chr(0x00F3), "o")   # ó
    safe = safe.replace(chr(0x00FA), "u")   # ú
    safe = safe.replace(chr(0x00C1), "A")   # Á
    safe = safe.replace(chr(0x00C9), "E")   # É
    safe = safe.replace(chr(0x00CD), "I")   # Í
    safe = safe.replace(chr(0x00D3), "O")   # Ó
    safe = safe.replace(chr(0x00DA), "U")   # Ú
    safe = safe.replace(chr(0x00F1), "n")   # ñ
    safe = safe.replace(chr(0x00D1), "N")   # Ñ
    safe = safe.replace(chr(0x00FC), "u")   # ü
    safe = safe.replace(chr(0x00DC), "U")   # Ü
    return safe


def _find_number_xobject(page) -> Any:
    xobjects = page["/Resources"].get("/XObject")
    if xobjects is None:
        raise ValueError("Template sin XObjects")
    for _, ref in xobjects.get_object().items():
        xobject = ref.get_object()
        if xobject.get("/Subtype") != "/Form":
            continue
        data = xobject.get_data()
        if data.count(b"Tj") != _NUMBER_XOBJECT_DRAW_COUNT:
            continue
        if all(marker in data for marker in _NUMBER_XOBJECT_MARKERS):
            return xobject
    raise ValueError("No se encontro el XObject del correlativo en el template")


def _ensure_number_font(xobject) -> None:
    resources = xobject["/Resources"].get_object()
    fonts = resources["/Font"].get_object()
    font_name = NameObject(_NUMBER_FONT_NAME)
    if font_name in fonts:
        return
    fonts[font_name] = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Courier-Bold"),
        NameObject("/Encoding"): NameObject("/WinAnsiEncoding"),
    })


def _update_number_xobject(page, padded_number: str) -> None:
    xobject = _find_number_xobject(page)
    _ensure_number_font(xobject)
    from pypdf.generic import ArrayObject, NumberObject
    xobject[NameObject("/BBox")] = ArrayObject([
        NumberObject(0), NumberObject(0), NumberObject(200), NumberObject(42)
    ])
    escaped = _escape_pdf_text(padded_number)
    xobject.set_data((
        "q\n"
        "3.7440772 0 0 3.7440772 .135864258 -3.3921204 cm\n"
        "1 0 0 RG\n"
        "1 0 0 rg\n"
        "/G3 gs\n"
        "/H2 <</MCID 93 >> BDC\n"
        "/NonStruct <<>> BDC\n"
        "BT\n"
        f"{_NUMBER_FONT_NAME} {_NUMBER_FONT_SIZE} Tf\n"
        "-0.98 Tc\n"
        "1 0 0 -1 0 9 Tm\n"
        f"({escaped}) Tj\n"
        "ET\n"
        "Q\n"
        "EMC\n"
        "EMC\n"
    ).encode("latin-1"))


def _update_accessible_number(reader: PdfReader, padded_number: str) -> None:
    for object_number in sorted(reader.xref.get(0, {}).keys()):
        obj = reader.get_object(IndirectObject(object_number, 0, reader))
        if not hasattr(obj, "get"):
            continue
        if obj.get("/T") == _TEMPLATE_NUMBER_TEXT or obj.get("/E") == _TEMPLATE_NUMBER_TEXT:
            obj[NameObject("/T")] = create_string_object(padded_number)
            obj[NameObject("/E")] = create_string_object(padded_number)
            return
    logger.warning("No se encontro metadata accesible para el correlativo")


def _apply_legacy_page_number(reader: PdfReader, page, number: int) -> None:
    padded = str(number).zfill(7)
    _update_number_xobject(page, padded)
    _update_accessible_number(reader, padded)


def _build_overlay_stamp_pdf(
    ll_x: float, ll_y: float, ur_x: float, ur_y: float,
    clean_name: str, overlay_stream: str
) -> bytes:
    overlay_bytes = overlay_stream.encode("latin-1")
    objects = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        (
            "3 0 obj\n"
            "<< /Type /Page /Parent 2 0 R "
            f"/MediaBox [{ll_x} {ll_y} {ur_x} {ur_y}] "
            "/Resources << /Font << "
            f"/{clean_name} << /Type /Font /Subtype /Type1 /BaseFont /{clean_name} /Encoding /WinAnsiEncoding >> "
            ">> >> /Contents 4 0 R >>\n"
            "endobj\n"
        ).encode("latin-1"),
        b"4 0 obj\n<< /Length " + str(len(overlay_bytes)).encode("ascii") + b" >>\nstream\n" + overlay_bytes + b"endstream\nendobj\n",
    ]
    pdf = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    offsets: list[int] = []
    for obj in objects:
        offsets.append(len(pdf))
        pdf += obj
    xref_offset = len(pdf)
    pdf += f"xref\n0 {len(objects) + 1}\n".encode("ascii")
    pdf += b"0000000000 65535 f \n"
    for offset in offsets:
        pdf += f"{offset:010d} 00000 n \n".encode("ascii")
    pdf += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF"
    ).encode("ascii")
    return pdf


def _append_rounded_rect_path(parts: list[str], x: float, y: float, width: float, height: float, radius: float) -> None:
    radius = max(0.0, min(radius, width / 2, height / 2))
    if radius == 0:
        parts.append(f"{x} {y} {width} {height} re")
        return
    k = radius * 0.5522847498
    right = x + width
    top = y + height
    parts.append(f"{x + radius} {y} m")
    parts.append(f"{right - radius} {y} l")
    parts.append(f"{right - radius + k} {y} {right} {y + radius - k} {right} {y + radius} c")
    parts.append(f"{right} {top - radius} l")
    parts.append(f"{right} {top - radius + k} {right - radius + k} {top} {right - radius} {top} c")
    parts.append(f"{x + radius} {top} l")
    parts.append(f"{x + radius - k} {top} {x} {top - radius + k} {x} {top - radius} c")
    parts.append(f"{x} {y + radius} l")
    parts.append(f"{x} {y + radius - k} {x + radius - k} {y} {x + radius} {y} c")
    parts.append("h")


def _blank_number_in_xobject(page, mcids: list[int]) -> None:
    xobjects = page["/Resources"].get("/XObject")
    if not xobjects:
        return
    for _, ref in xobjects.get_object().items():
        xobj = ref.get_object()
        if xobj.get("/Subtype") != "/Form":
            continue
        data = xobj.get_data()
        modified = False
        for mcid in mcids:
            marker_pat = re.compile(rb'MCID\s*' + str(mcid).encode() + rb'\s*>>\s*BDC')
            marker = marker_pat.search(data)
            if not marker:
                continue
            section_start = marker.end()
            next_mcid = re.search(rb'MCID\s+\d+', data[section_start + 4:])
            section_end = (
                section_start + 4 + next_mcid.start()
                if next_mcid
                else min(section_start + 1500, len(data))
            )
            section = data[section_start:section_end]
            new_section = re.sub(rb'\([^\)]{1,4}\)\s*Tj', b'(\x00\x03) Tj', section)
            if new_section != section:
                data = data[:section_start] + new_section + data[section_end:]
                modified = True
        if modified:
            xobj.set_data(data)


def _apply_visual_overlay(page, number: int, mapping: dict[str, Any]) -> None:
    padded = str(number).zfill(mapping.get("padding", 7))
    escaped = _escape_pdf_text(padded)
    escaped_label = _escape_pdf_text("OT:")
    mediabox = page.mediabox
    ll_x = float(mediabox.lower_left[0])
    ll_y = float(mediabox.lower_left[1])
    ur_x = float(mediabox.upper_right[0])
    ur_y = float(mediabox.upper_right[1])
    pdf_y = ur_y - mapping["y"] - mapping["font_size"]
    clean_name = mapping["font_name"].replace("/", "")
    parts: list[str] = ["q"]
    bx = mapping.get("blank_x")
    by = mapping.get("blank_y")
    bw = mapping.get("blank_width")
    bh = mapping.get("blank_height")
    has_blank = all(v is not None for v in (bx, by, bw, bh))
    if has_blank:
        blank_pdf_y = ur_y - by - bh  # type: ignore[operator]
        parts.append("1 1 1 rg")
        parts.append(f"{bx} {blank_pdf_y} {bw} {bh} re")
        parts.append("f")
        if mapping.get("redraw_ot_badge"):
            badge_x = float(bx)  # type: ignore[arg-type]
            badge_y = float(blank_pdf_y)
            badge_width = float(bw)  # type: ignore[arg-type]
            badge_height = float(bh)  # type: ignore[arg-type]
            radius = min(8.0, badge_height / 2)
            parts.append(f"{mapping['color_r']} {mapping['color_g']} {mapping['color_b']} RG")
            parts.append("1 1 1 rg")
            parts.append("1.35 w")
            _append_rounded_rect_path(parts, badge_x, badge_y, badge_width, badge_height, radius)
            parts.append("B")
            parts.append(f"{mapping['color_r']} {mapping['color_g']} {mapping['color_b']} rg")
            parts.append("BT")
            parts.append(f"/{clean_name} {mapping['font_size']} Tf")
            parts.append(f"{badge_x + 14} {pdf_y} Td")
            parts.append(f"({escaped_label}) Tj")
            parts.append("ET")
        elif mapping.get("redraw_top_border"):
            top_y = blank_pdf_y + bh  # type: ignore[operator]
            right_x = bx + bw  # type: ignore[operator]
            parts.append(f"{mapping['color_r']} {mapping['color_g']} {mapping['color_b']} RG")
            parts.append("1 w")
            parts.append(f"{bx} {top_y} m")
            parts.append(f"{right_x} {top_y} l")
            parts.append("S")
    parts.append(f"{mapping['color_r']} {mapping['color_g']} {mapping['color_b']} rg")
    parts.append("BT")
    parts.append(f"/{clean_name} {mapping['font_size']} Tf")
    parts.append(f"{mapping['x']} {pdf_y} Td")
    parts.append(f"({escaped}) Tj")
    parts.append("ET")
    parts.append("Q")
    overlay_stream = "\n".join(parts) + "\n"
    stamp_pdf = _build_overlay_stamp_pdf(ll_x, ll_y, ur_x, ur_y, clean_name, overlay_stream)
    stamp_reader = PdfReader(io.BytesIO(stamp_pdf))
    page.merge_page(stamp_reader.pages[0])


def _generate_legacy(template_bytes: bytes, desde: int, hasta: int) -> bytes:
    writer = PdfWriter()
    for number in range(desde, hasta + 1):
        reader = PdfReader(io.BytesIO(template_bytes))
        page = reader.pages[0]
        _apply_legacy_page_number(reader, page, number)
        writer.add_page(page)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def _generate_visual(template_bytes: bytes, desde: int, hasta: int, mapping: dict[str, Any]) -> bytes:
    writer = PdfWriter()
    for number in range(desde, hasta + 1):
        reader = PdfReader(io.BytesIO(template_bytes))
        target_page_idx = min(mapping.get("page", 0), len(reader.pages) - 1)
        page = reader.pages[target_page_idx]
        if mapping.get("blank_mcids"):
            _blank_number_in_xobject(page, mapping["blank_mcids"])
        _apply_visual_overlay(page, number, mapping)
        writer.add_page(page)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


_DEFAULT_OVERLAY_MAPPING = {
    "page": 0, "x": 500, "y": 30, "width": 140, "height": 20,
    "font_size": 12, "font_name": "Helvetica-Bold",
    "color_r": 0, "color_g": 0, "color_b": 0,
    "padding": 7,
    "blank_x": None, "blank_y": None, "blank_width": None, "blank_height": None,
    "redraw_top_border": False, "redraw_ot_badge": False, "blank_mcids": None,
}


def _generate_simple_overlay(template_bytes: bytes, desde: int, hasta: int) -> bytes:
    return _generate_visual(template_bytes, desde, hasta, _DEFAULT_OVERLAY_MAPPING)


def generate_pdf(fmt_id: str, desde: int, hasta: int) -> tuple[bytes, str]:
    entry = get_format(fmt_id)
    if entry is None:
        raise ValueError("Formato no encontrado")
    if not entry.get("enabled", True):
        raise ValueError("Formato deshabilitado")
    if desde > hasta:
        raise ValueError("'desde' debe ser menor o igual a 'hasta'")
    total = hasta - desde + 1
    if total > entry["max_pages"]:
        raise ValueError(f"Maximo {entry['max_pages']} paginas por solicitud")
    if desde < entry["number_min"] or hasta > entry["number_max"]:
        raise ValueError(f"Rango fuera de limites ({entry['number_min']} - {entry['number_max']})")
    if entry["strategy"] == VISUAL_OVERLAY and entry.get("mapping") is None:
        raise ValueError("Este formato requiere configurar el mapping visual antes de generar")

    template_bytes = _load_template_bytes(entry)
    strategy = entry["strategy"]
    if strategy == LEGACY_XOBJECT:
        pdf_bytes = _generate_legacy(template_bytes, desde, hasta)
    elif strategy == SIMPLE_OVERLAY:
        pdf_bytes = _generate_simple_overlay(template_bytes, desde, hasta)
    else:
        pdf_bytes = _generate_visual(template_bytes, desde, hasta, entry["mapping"])

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
