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
        "component",
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
        "boolean",
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
        "guides": [],
        "styles": [],
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


def _normalize_css_vars(raw: Any, *, with_geometry_defaults: bool = True) -> dict[str, str]:
    if not isinstance(raw, dict):
        if not with_geometry_defaults:
            return {}
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
    if with_geometry_defaults:
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
            value = raw[bool_key]
            if isinstance(value, str):
                cleaned[bool_key] = value.strip().lower() not in ("", "0", "false", "no", "off")
            else:
                cleaned[bool_key] = bool(value)
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
    if isinstance(raw.get("path"), dict):
        raw_path = raw["path"]
        if isinstance(raw_path.get("points"), list):
            cleaned_points = []
            for pt in raw_path["points"]:
                if not isinstance(pt, dict):
                    continue
                try:
                    pt_dict: dict[str, Any] = {
                        "x": float(pt.get("x", 0)),
                        "y": float(pt.get("y", 0)),
                    }
                    if isinstance(pt.get("hin"), dict):
                        pt_dict["hin"] = {
                            "x": float(pt["hin"].get("x", 0)),
                            "y": float(pt["hin"].get("y", 0)),
                        }
                    elif pt.get("hin") is None and "hin" in pt:
                        pt_dict["hin"] = None

                    if isinstance(pt.get("hout"), dict):
                        pt_dict["hout"] = {
                            "x": float(pt["hout"].get("x", 0)),
                            "y": float(pt["hout"].get("y", 0)),
                        }
                    elif pt.get("hout") is None and "hout" in pt:
                        pt_dict["hout"] = None

                    cleaned_points.append(pt_dict)
                except (TypeError, ValueError):
                    continue
            path_dict: dict[str, Any] = {"points": cleaned_points}
            if "closed" in raw_path:
                path_dict["closed"] = bool(raw_path["closed"])
            cleaned["path"] = path_dict
    for track_key in ("colTracks", "rowTracks"):
        tracks = _normalize_track_list(raw.get(track_key))
        if tracks is not None:
            cleaned[track_key] = tracks
    auto_layout = _normalize_auto_layout(raw.get("autoLayout"))
    if auto_layout is not None:
        cleaned["autoLayout"] = auto_layout
    for constraint_key in ("constraintH", "constraintV"):
        constraint = _normalize_frame_constraint(raw.get(constraint_key))
        if constraint is not None:
            cleaned[constraint_key] = constraint
    instance_of = raw.get("instanceOf")
    if isinstance(instance_of, str) and instance_of.strip():
        cleaned["instanceOf"] = instance_of.strip()
    override_vars = raw.get("overrideVars")
    if isinstance(override_vars, dict):
        ov = _normalize_css_vars(override_vars, with_geometry_defaults=False)
        if ov:
            cleaned["overrideVars"] = ov
    variant = raw.get("variant")
    if isinstance(variant, str) and variant.strip():
        cleaned["variant"] = variant.strip()
    component_id = raw.get("componentId")
    if isinstance(component_id, str) and component_id.strip():
        cleaned["componentId"] = component_id.strip()
    variants_raw = raw.get("variants")
    if isinstance(variants_raw, dict):
        variants_out: dict[str, dict[str, str]] = {}
        for key, value in variants_raw.items():
            if not isinstance(key, str) or not key.strip():
                continue
            if not isinstance(value, dict):
                continue
            patch = _normalize_css_vars(value, with_geometry_defaults=False)
            if patch:
                variants_out[key.strip()] = patch
        if variants_out:
            cleaned["variants"] = variants_out
    mask_layer_id = raw.get("maskLayerId")
    if isinstance(mask_layer_id, str) and mask_layer_id.strip():
        cleaned["maskLayerId"] = mask_layer_id.strip()
    ops_out = _normalize_boolean_ops(raw.get("ops"))
    if ops_out is not None:
        cleaned["ops"] = ops_out
    return cleaned or None


_ALLOWED_BOOLEAN_OPS = frozenset({"union", "subtract", "intersect", "exclude"})


def _normalize_boolean_ops(raw: Any) -> list[dict[str, str]] | None:
    """Keep valid boolean ops entries; omit key entirely if none valid."""
    if not isinstance(raw, list) or not raw:
        return None
    ops_out: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        op = item.get("op")
        layer_id = item.get("layerId")
        if op not in _ALLOWED_BOOLEAN_OPS:
            continue
        if not isinstance(layer_id, str) or not layer_id.strip():
            continue
        ops_out.append({"op": str(op), "layerId": layer_id.strip()})
    return ops_out or None


_AUTO_LAYOUT_ALIGNS = frozenset({"start", "center", "end", "stretch"})
_FRAME_CONSTRAINTS = frozenset({"start", "end", "center", "scale"})


def _normalize_auto_layout(raw: Any) -> dict[str, Any] | None:
    """Keep a valid autoLayout object; omit key entirely if invalid (no defaults)."""
    if not isinstance(raw, dict):
        return None
    direction = raw.get("direction")
    if direction not in ("row", "col"):
        return None
    sizing = raw.get("sizing")
    if sizing not in ("hug", "fixed"):
        return None
    align_main = raw.get("alignMain")
    align_cross = raw.get("alignCross")
    if align_main not in _AUTO_LAYOUT_ALIGNS or align_cross not in _AUTO_LAYOUT_ALIGNS:
        return None
    try:
        gap_mm = float(raw["gapMm"])
        pad_mm = float(raw["padMm"])
    except (KeyError, TypeError, ValueError):
        return None
    if gap_mm < 0 or pad_mm < 0 or gap_mm != gap_mm or pad_mm != pad_mm:
        return None
    return {
        "direction": direction,
        "gapMm": gap_mm,
        "padMm": pad_mm,
        "alignMain": align_main,
        "alignCross": align_cross,
        "sizing": sizing,
    }


def _normalize_frame_constraint(raw: Any) -> str | None:
    if raw in _FRAME_CONSTRAINTS:
        return str(raw)
    return None


def _normalize_track_list(raw: Any) -> list[float] | None:
    """Keep positive float track weights; omit key if invalid (do not invent defaults)."""
    if not isinstance(raw, list) or not raw:
        return None
    tracks: list[float] = []
    for item in raw:
        try:
            value = float(item)
        except (TypeError, ValueError):
            return None
        if value <= 0 or value != value:  # NaN check
            return None
        tracks.append(value)
    return tracks


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
    for key in ("fillStyleId", "textStyleId", "effectStyleId"):
        val = raw.get(key)
        if isinstance(val, str) and val.strip():
            layer[key] = val.strip()
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
    if "pageMarginMm" in raw:
        try:
            margin = float(raw["pageMarginMm"])
            if margin >= 0:
                out["pageMarginMm"] = margin
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


_STYLE_KINDS = frozenset({"color", "text", "effect"})


def _normalize_styles(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    styles: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "")
        if kind not in _STYLE_KINDS:
            continue
        style_id = str(item.get("id") or "").strip() or _new_id()
        name = str(item.get("name") or kind).strip() or kind
        css = _normalize_css_vars(item.get("cssVars"), with_geometry_defaults=False)
        styles.append({"id": style_id, "name": name, "kind": kind, "cssVars": css})
    return styles


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
        try:
            page_index = int(item.get("pageIndex", 0))
        except (TypeError, ValueError):
            page_index = 0
        if page_index < 0:
            page_index = 0
        guides.append({"id": guide_id, "axis": axis, "posMm": pos_mm, "pageIndex": page_index})
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

    pages = _normalize_pages(raw.get("pages"))
    # Clamp pageIndex into the valid page range so a stale/legacy index cannot
    # create invisible "ghost" layers on a non-existent page.
    last_page = len(pages) - 1
    layers = [
        {**layer, "pageIndex": min(max(0, int(layer.get("pageIndex", 0))), last_page)} for layer in layers
    ]

    return {
        "version": DOCUMENT_VERSION,
        "id": str(raw.get("id") or _new_id()),
        "name": str(raw.get("name") or "Sin título").strip() or "Sin título",
        "updatedAt": updated_at or utc_now_iso(),
        "page": {"widthMm": max(1, width_mm), "heightMm": max(1, height_mm)},
        "pages": pages,
        "settings": _normalize_settings(raw.get("settings")),
        "guides": _normalize_guides(raw.get("guides")),
        "styles": _normalize_styles(raw.get("styles")),
        "layers": layers,
        "fields": _normalize_fields(raw.get("fields")),
    }


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
            if parent in id_map:
                layer["parentId"] = id_map[parent]
            else:
                # Parent was not duplicated (orphan reference in source) — drop
                # the dangling id instead of pointing at a non-existent layer.
                layer.pop("parentId", None)
        meta = layer.get("meta")
        if isinstance(meta, dict):
            for key in ("instanceOf", "componentId", "maskLayerId"):
                val = meta.get(key)
                if isinstance(val, str) and val in id_map:
                    meta[key] = id_map[val]
            ops = meta.get("ops")
            if isinstance(ops, list):
                for entry in ops:
                    if not isinstance(entry, dict):
                        continue
                    lid = entry.get("layerId")
                    if isinstance(lid, str) and lid in id_map:
                        entry["layerId"] = id_map[lid]
    for field in doc["fields"]:
        field["id"] = _new_id()
    for page in doc.get("pages") or []:
        page["id"] = _new_id()
    return doc
