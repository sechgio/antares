"""CanvasDocument schema — Layer[] inspired by shadcn/designer (reference only)."""

from __future__ import annotations

import contextlib
import copy
import re
import uuid
from datetime import datetime, timezone
from typing import Any

DOCUMENT_VERSION = 2


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
ALLOWED_LAYER_TYPES = frozenset(
    {
        "text",
        "image",
        "frame",
        "field",
        "logo",
        "imageSlot",
        "rect",
        "grid",
        "group",
        "table",
        "checkbox",
        "signature",
        "line",
        "ellipse",
        "arrow",
        "polygon",
        "star",
        "diamond",
        "hexagon",
        "pentagon",
    }
)
A4_WIDTH_MM = 210
A4_HEIGHT_MM = 297


def _new_id() -> str:
    return str(uuid.uuid4())


def create_empty_document(*, name: str = "Sin título") -> dict[str, Any]:
    doc_id = _new_id()
    page_id = _new_id()
    return {
        "version": DOCUMENT_VERSION,
        "id": doc_id,
        "name": name.strip() or "Sin título",
        "updatedAt": utc_now_iso(),
        "page": {"widthMm": A4_WIDTH_MM, "heightMm": A4_HEIGHT_MM},
        "pages": [{"id": page_id, "name": "Página 1"}],
        "settings": {},
        "layers": [
            {
                "id": _new_id(),
                "type": "frame",
                "name": "Página A4",
                "value": "",
                "locked": True,
                "pageIndex": 0,
                "cssVars": {
                    "--width": f"{A4_WIDTH_MM}mm",
                    "--height": f"{A4_HEIGHT_MM}mm",
                    "--translate-x": "0mm",
                    "--translate-y": "0mm",
                    "--background-color": "#ffffff",
                },
            }
        ],
        "fields": [],
    }


def _normalize_css_vars(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {
            "--width": "40mm",
            "--height": "10mm",
            "--translate-x": "10mm",
            "--translate-y": "10mm",
        }
    out: dict[str, str] = {}
    for key, value in raw.items():
        if isinstance(key, str) and isinstance(value, (str, int, float)):
            out[key] = str(value)
    out.setdefault("--width", "40mm")
    out.setdefault("--height", "10mm")
    out.setdefault("--translate-x", "10mm")
    out.setdefault("--translate-y", "10mm")
    return out


def _normalize_meta(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    cleaned: dict[str, Any] = {}
    if "key" in raw:
        cleaned["key"] = str(raw["key"])
    if "fallback" in raw:
        cleaned["fallback"] = str(raw["fallback"])
    if raw.get("side") in ("left", "right"):
        cleaned["side"] = raw["side"]
    for int_key in ("index", "cols", "rows", "pageIndex", "imagesPerPage"):
        if int_key in raw:
            try:
                cleaned[int_key] = int(raw[int_key])
            except (TypeError, ValueError):
                cleaned[int_key] = 0
    if "gapMm" in raw:
        try:
            cleaned["gapMm"] = float(raw["gapMm"])
        except (TypeError, ValueError):
            cleaned["gapMm"] = 2.0
    for bool_key in ("showDate", "showCoords", "showFilename", "checked"):
        if bool_key in raw:
            cleaned[bool_key] = bool(raw[bool_key])
    if "rowsData" in raw and raw["rowsData"] is not None:
        cleaned["rowsData"] = str(raw["rowsData"])
    if isinstance(raw.get("rules"), list):
        rules = []
        for item in raw["rules"]:
            if not isinstance(item, dict):
                continue
            try:
                rules.append(
                    {
                        "whenImages": int(item.get("whenImages", 0)),
                        "cols": int(item.get("cols", 1)),
                        "rows": int(item.get("rows", 1)),
                    }
                )
            except (TypeError, ValueError):
                continue
        if rules:
            cleaned["rules"] = rules
    return cleaned or None


def _normalize_layer(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    layer_type = str(raw.get("type", "text"))
    if layer_type not in ALLOWED_LAYER_TYPES:
        return None
    layer: dict[str, Any] = {
        "id": str(raw.get("id") or _new_id()),
        "type": layer_type,
        "name": str(raw.get("name") or layer_type).strip() or layer_type,
        "value": "" if raw.get("value") is None else str(raw.get("value")),
        "locked": bool(raw.get("locked", False)),
        "cssVars": _normalize_css_vars(raw.get("cssVars")),
    }
    if raw.get("parentId"):
        layer["parentId"] = str(raw["parentId"])
    if "visible" in raw:
        layer["visible"] = bool(raw["visible"])
    try:
        layer["pageIndex"] = int(raw.get("pageIndex", 0))
    except (TypeError, ValueError):
        layer["pageIndex"] = 0
    meta = _normalize_meta(raw.get("meta"))
    if meta:
        layer["meta"] = meta
    return layer


def _normalize_fields(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    fields: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip()
        if not key:
            continue
        fields.append(
            {
                "id": str(item.get("id") or _new_id()),
                "key": key,
                "label": str(item.get("label") or key).strip() or key,
            }
        )
    return fields


def _normalize_pages(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list) or not raw:
        return [{"id": _new_id(), "name": "Página 1"}]
    pages: list[dict[str, str]] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        pages.append(
            {
                "id": str(item.get("id") or _new_id()),
                "name": str(item.get("name") or f"Página {index + 1}").strip() or f"Página {index + 1}",
            }
        )
    return pages or [{"id": _new_id(), "name": "Página 1"}]


def _normalize_settings(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    if "imagesPerPage" in raw:
        with contextlib.suppress(TypeError, ValueError):
            out["imagesPerPage"] = max(1, int(raw["imagesPerPage"]))
    if "showRulers" in raw:
        out["showRulers"] = bool(raw["showRulers"])
    if "snapToGrid" in raw:
        out["snapToGrid"] = bool(raw["snapToGrid"])
    if "gridSizeMm" in raw:
        try:
            size = float(raw["gridSizeMm"])
            if size > 0:
                out["gridSizeMm"] = size
        except (TypeError, ValueError):
            pass
    if isinstance(raw.get("gridRules"), list):
        rules = []
        for item in raw["gridRules"]:
            if not isinstance(item, dict):
                continue
            try:
                rules.append(
                    {
                        "whenImages": int(item.get("whenImages", 0)),
                        "cols": int(item.get("cols", 1)),
                        "rows": int(item.get("rows", 1)),
                    }
                )
            except (TypeError, ValueError):
                continue
        if rules:
            out["gridRules"] = rules
    return out


def _normalize_guides(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    guides: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        axis = item.get("axis")
        if axis not in ("x", "y"):
            continue
        try:
            pos_mm = float(item.get("posMm", 0))
        except (TypeError, ValueError):
            continue
        guide_id = str(item.get("id") or "").strip() or _new_id()
        guides.append({"id": guide_id, "axis": axis, "posMm": pos_mm})
    return guides


def normalize_document(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return create_empty_document()

    page_raw: Any = raw.get("page")
    if not isinstance(page_raw, dict):
        page_raw = {}
    try:
        width_mm = int(page_raw.get("widthMm", A4_WIDTH_MM))
    except (TypeError, ValueError):
        width_mm = A4_WIDTH_MM
    try:
        height_mm = int(page_raw.get("heightMm", A4_HEIGHT_MM))
    except (TypeError, ValueError):
        height_mm = A4_HEIGHT_MM

    layers_in = raw.get("layers")
    layers: list[dict[str, Any]] = []
    if isinstance(layers_in, list):
        for item in layers_in:
            layer = _normalize_layer(item)
            if layer is not None:
                layers.append(layer)
    if not layers:
        layers = create_empty_document()["layers"]

    updated_raw = raw.get("updatedAt")
    updated_at = str(updated_raw).strip() if isinstance(updated_raw, str) and str(updated_raw).strip() else ""

    return {
        "version": DOCUMENT_VERSION,
        "id": str(raw.get("id") or _new_id()),
        "name": str(raw.get("name") or "Sin título").strip() or "Sin título",
        "updatedAt": updated_at or utc_now_iso(),
        "page": {"widthMm": max(1, width_mm), "heightMm": max(1, height_mm)},
        "pages": _normalize_pages(raw.get("pages")),
        "settings": _normalize_settings(raw.get("settings")),
        "guides": _normalize_guides(raw.get("guides")),
        "layers": layers,
        "fields": _normalize_fields(raw.get("fields")),
    }


# Alias for type checkers / imports
CanvasDocument = dict[str, Any]


def next_copy_name(name: str, existing_names: set[str] | None = None) -> str:
    """Build a unique copy name: 'X (copia)', 'X (copia 2)', … without nesting suffixes."""
    taken = existing_names or set()
    raw = (name or "").strip() or "Sin título"
    base = re.sub(r"(?: \(copia(?: \d+)?\))+$", "", raw).strip() or raw
    candidate = f"{base} (copia)"
    n = 2
    while candidate in taken:
        candidate = f"{base} (copia {n})"
        n += 1
    return candidate


def duplicate_document(
    source: dict[str, Any],
    *,
    name: str | None = None,
    existing_names: set[str] | None = None,
) -> dict[str, Any]:
    doc = normalize_document(copy.deepcopy(source))
    doc["id"] = _new_id()
    doc["updatedAt"] = utc_now_iso()
    if name is not None and str(name).strip():
        doc["name"] = str(name).strip()
    else:
        doc["name"] = next_copy_name(doc["name"], existing_names)
    id_map: dict[str, str] = {}
    for layer in doc["layers"]:
        new_id = _new_id()
        id_map[layer["id"]] = new_id
        layer["id"] = new_id
    for layer in doc["layers"]:
        parent = layer.get("parentId")
        if parent:
            layer["parentId"] = id_map.get(parent, parent)
    for field in doc["fields"]:
        field["id"] = _new_id()
    for page in doc.get("pages") or []:
        page["id"] = _new_id()
    return doc
