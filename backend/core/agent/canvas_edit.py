from __future__ import annotations

import copy
import math
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.core.exceptions import ResourceLockedError, ValidationError
from backend.core.integrations.types import JsonObject
from backend.core.ipc_catalog import input_schema_for

TOOL_SPECS: list[JsonObject] = [
    {
        "name": "canvas_apply_layers",
        "gated": True,
        "module": "canvas",
        "description": (
            "Maquetar Canvas sin clics: crear, actualizar, borrar y ordenar capas con geometría en mm, "
            "crear fields y rellenarlos con values. Consulta canvas_get antes; exige expected_updated_at. "
            "Devuelve layers persistidos, createdLayers y updatedAt. Requiere aprobación del usuario."
        ),
        "inputSchema": input_schema_for("agent_canvas_apply_layers"),
    },
    {
        "name": "canvas_fill_fields",
        "gated": True,
        "module": "canvas",
        "description": (
            "Canvas · canvas_fill_fields (efecto: requiere aprobación del usuario): rellena campos existentes de "
            "un documento de Canvas contra la revisión leída con canvas_get"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "string", "description": "ID del documento de Canvas"},
                "expected_updated_at": {"type": "string", "description": "updatedAt leído con canvas_get"},
                "values": {"type": "object", "description": "Campo (meta.key) → valor de texto"},
            },
            "required": ["id", "expected_updated_at", "values"],
        },
    },
]


_GEOMETRY = ("--translate-x", "--translate-y", "--width", "--height")
_CSS_KEYS = frozenset((*_GEOMETRY, "--font-size", "--font-family", "--color", "--background-color",
                       "--text-align", "--border-radius", "--opacity"))
_LAYER_KEYS = frozenset(("id", "type", "name", "value", "pageIndex", "parentId", "cssVars", "meta"))


def _length(value: object, key: str, units: str = "mm") -> float:
    if not isinstance(value, str) or not re.fullmatch(rf"(?:\d+(?:\.\d+)?|\.\d+)({units})", value):
        raise ValidationError(f"{key} debe ser una longitud no negativa en {units}")
    number = float(re.sub(r"[a-z]+$", "", value))
    if not math.isfinite(number):
        raise ValidationError(f"{key} debe ser finito")
    return number


def _text(value: object, key: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{key} debe ser un texto no vacío")
    return value


def _validate_layer(layer: JsonObject, document: JsonObject) -> None:
    from backend.core.canvas.models import ALLOWED_LAYER_TYPES

    if not isinstance(layer.get("type"), str) or layer["type"] not in ALLOWED_LAYER_TYPES:
        raise ValidationError("type de capa no admitido")
    _text(layer.get("name"), "name")
    if not isinstance(layer.get("value"), str):
        raise ValidationError("value debe ser un texto")
    page = layer.get("pageIndex")
    if type(page) is not int or not 0 <= page < len(document["pages"]):
        raise ValidationError("pageIndex fuera de las páginas del documento")
    css = layer["cssVars"]
    x, y, width, height = (_length(css.get(key), key) for key in _GEOMETRY)
    if width <= 0 or height <= 0:
        raise ValidationError("--width y --height deben ser mayores que cero")
    if x + width > document["page"]["widthMm"] or y + height > document["page"]["heightMm"]:
        raise ValidationError("Las coordenadas y dimensiones de la capa deben quedar dentro de la página")
    if "--font-size" in css and _length(css["--font-size"], "--font-size", "mm|pt") <= 0:
        raise ValidationError("--font-size debe ser mayor que cero")
    if "--border-radius" in css:
        _length(css["--border-radius"], "--border-radius")
    if "--text-align" in css and css["--text-align"] not in {"left", "center", "right", "justify"}:
        raise ValidationError("--text-align debe ser left, center, right o justify")
    if "--opacity" in css:
        try:
            opacity = float(css["--opacity"])
        except ValueError as exc:
            raise ValidationError("--opacity debe estar entre 0 y 1") from exc
        if not math.isfinite(opacity) or not 0 <= opacity <= 1:
            raise ValidationError("--opacity debe estar entre 0 y 1")


def _apply_layer_operations(document: JsonObject, operations: list[object], mode: str) -> list[str]:
    layers = document["layers"] if mode == "merge" else []
    document["layers"] = layers
    created: list[str] = []
    touched: set[str] = set()
    for item in operations:
        if not isinstance(item, dict):
            raise ValidationError("Cada operación de layers debe ser un objeto")
        if set(item) - (_LAYER_KEYS | {"op", "index"}):
            raise ValidationError("Propiedad de capa no admitida")
        layer_id = _text(item["id"], "id de capa") if "id" in item else str(uuid.uuid4())
        existing = next((layer for layer in layers if layer["id"] == layer_id), None)
        op = item.get("op", "update" if existing else "create")
        if not isinstance(op, str) or op not in {"create", "update", "delete", "reorder"}:
            raise ValidationError("op debe ser create, update, delete o reorder")
        if op != "create" and existing is None:
            raise ValidationError(f"Capa no encontrada: {layer_id}")
        if op == "create" and existing is not None:
            raise ValidationError(f"ID de capa duplicado: {layer_id}")
        if op in {"delete", "reorder"}:
            if set(item) - {"id", "op", "index"}:
                raise ValidationError("delete/reorder solo admiten id, op e index")
            layers.remove(existing)
            if op == "reorder":
                index = item.get("index")
                if type(index) is not int or not 0 <= index <= len(layers):
                    raise ValidationError("index fuera del orden de capas")
                layers.insert(index, existing)
            continue
        if "index" in item:
            raise ValidationError("Usa op reorder para cambiar el orden")
        patch = {key: copy.deepcopy(value) for key, value in item.items() if key in _LAYER_KEYS}
        css = patch.pop("cssVars", {})
        if not isinstance(css, dict) or set(css) - _CSS_KEYS:
            raise ValidationError("cssVars contiene propiedades no admitidas")
        for key, value in css.items():
            _text(value, key)
        if "meta" in patch:
            meta = patch["meta"]
            if not isinstance(meta, dict) or set(meta) != {"key"}:
                raise ValidationError("meta solo admite key para vincular campos")
            _text(meta["key"], "meta.key")
            if existing is not None:
                patch["meta"] = {**existing.get("meta", {}), **meta}
        layer: JsonObject = existing if existing is not None else {"id": layer_id, "value": "", "pageIndex": 0}
        layer.update({**patch, "cssVars": {**layer.get("cssVars", {}), **css}})
        if layer.get("parentId") is None:
            layer.pop("parentId", None)
        elif "parentId" in layer:
            _text(layer["parentId"], "parentId")
        touched.add(layer_id)
        if existing is None:
            layers.append(layer)
            created.append(layer_id)
    by_id = {layer["id"]: layer for layer in layers}
    for layer in layers:
        if layer["id"] in touched:
            _validate_layer(layer, document)
        visited = {layer["id"]}
        parent = layer.get("parentId")
        while parent:
            if parent not in by_id or parent in visited:
                raise ValidationError("parentId inexistente o ciclo entre capas")
            ancestor = by_id[parent]
            if ancestor["pageIndex"] != layer["pageIndex"] or ancestor["type"] not in {"group", "frame", "component"}:
                raise ValidationError("parentId debe ser un contenedor de la misma página")
            visited.add(parent)
            parent = ancestor.get("parentId")
    return created


def apply_layers(params: JsonObject) -> JsonObject:
    from backend.core.canvas import get_canvas_store
    from backend.core.canvas.models import utc_now_iso

    doc_id = _text(params.get("id"), "id del documento")
    expected = _text(params.get("expected_updated_at"), "expected_updated_at")
    mode = params.get("mode", "merge")
    operations = params.get("layers")
    if not isinstance(mode, str) or mode not in {"merge", "replace"} or not isinstance(operations, list):
        raise ValidationError("Indica mode merge/replace y una lista layers")
    fields = params.get("fields", [])
    values = params.get("values", {})
    if not isinstance(fields, list) or not isinstance(values, dict):
        raise ValidationError("fields debe ser una lista y values un objeto")
    store = get_canvas_store()
    with store._doc_lock(doc_id):
        document = store.get(doc_id)
        if document is None:
            raise ValidationError("Documento de Canvas no encontrado")
        if document["updatedAt"] != expected:
            raise ResourceLockedError("expected_updated_at no coincide: el documento cambió; vuelve a leer canvas_get")
        previous = copy.deepcopy(document)
        previous_field_keys = {layer["id"]: (layer.get("meta") or {}).get("key")
                               for layer in previous["layers"] if layer["type"] == "field"}
        created = _apply_layer_operations(document, operations, mode)
        definitions = {field["key"]: field for field in document["fields"]} if mode == "merge" else {}
        seen: set[str] = set()
        for field in fields:
            if not isinstance(field, dict) or set(field) - {"id", "key", "label"}:
                raise ValidationError("Cada field admite id, key y label")
            key = _text(field.get("key"), "field.key")
            if key != key.strip() or key in seen:
                raise ValidationError("field.key duplicada o con espacios exteriores")
            seen.add(key)
            definitions[key] = {
                "id": _text(field.get("id", definitions.get(key, {}).get("id", str(uuid.uuid4()))), "field.id"),
                "key": key, "label": _text(field.get("label", key), "field.label"),
            }
        for layer in document["layers"]:
            if layer["type"] == "field":
                layer_key = (layer.get("meta") or {}).get("key")
                is_new_key = layer["id"] not in previous_field_keys or previous_field_keys[layer["id"]] != layer_key
                if is_new_key:
                    _text(layer_key, "meta.key de field")
                if is_new_key and layer_key not in definitions:
                    raise ValidationError(f"Define el campo en fields antes de usarlo: {layer_key}")
                if layer_key in values:
                    value = values[layer_key]
                    if not isinstance(value, str):
                        raise ValidationError("Los values de campos deben ser textos")
                    layer["value"] = value
        layer_keys = {layer.get("meta", {}).get("key") for layer in document["layers"] if layer["type"] == "field"}
        if set(values) - layer_keys:
            raise ValidationError("values contiene campos sin capa field")
        document["fields"] = list(definitions.values())
        if len({field["id"] for field in document["fields"]}) != len(definitions):
            raise ValidationError("field.id duplicado")
        document["updatedAt"] = utc_now_iso()
        if document["updatedAt"] <= expected:
            try:
                previous_time = datetime.fromisoformat(expected.replace("Z", "+00:00"))
                next_time = max(datetime.now(timezone.utc), previous_time + timedelta(milliseconds=1))
            except (ValueError, TypeError) as exc:
                raise ValidationError("La revisión guardada no es una fecha ISO válida") from exc
            document["updatedAt"] = next_time.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        saved = store.save(document, touch=False, expected_updated_at=expected)
        history = store.get_history(doc_id)
        store.save_history(doc_id, [*history["past"], previous], [])
        return {
            "id": doc_id, "updatedAt": saved["updatedAt"], "layers": saved["layers"], "fields": saved["fields"],
            "createdLayers": [{"id": layer["id"], "name": layer["name"]}
                              for layer in saved["layers"] if layer["id"] in created],
        }


def fill_fields(params: JsonObject) -> JsonObject:
    from backend.core.canvas import get_canvas_store

    doc_id = params.get("id")
    expected = params.get("expected_updated_at")
    values = params.get("values")
    if not isinstance(doc_id, str) or not doc_id:
        raise ValueError("Indica el documento de Canvas")
    if not isinstance(expected, str) or not expected:
        raise ValueError("Indica la revisión leída (expected_updated_at) del documento")
    if not isinstance(values, dict) or not values:
        raise ValueError("Indica los campos a rellenar")
    store = get_canvas_store()
    with store._doc_lock(doc_id):
        document: Any = store.get(doc_id)
        if document is None:
            raise ValueError("Documento de Canvas no encontrado")
        if document.get("updatedAt") != expected:
            raise ValueError("El documento cambió desde que se leyó; vuelve a consultarlo antes de editarlo")
        keys = {str((layer.get("meta") or {}).get("key")) for layer in document.get("layers") or []
                if layer.get("type") == "field" and (layer.get("meta") or {}).get("key")}
        unknown = sorted(str(k) for k in values if str(k) not in keys)
        if unknown:
            raise ValueError(f"El documento no tiene estos campos: {', '.join(unknown)}")
        changed = 0
        previous = copy.deepcopy(document)
        for layer in document["layers"]:
            key = (layer.get("meta") or {}).get("key") if layer.get("type") == "field" else None
            if key is not None and str(key) in values:
                layer["value"] = "" if values[str(key)] is None else str(values[str(key)])
                changed += 1
        saved = store.save(document, expected_updated_at=expected)
        history = store.get_history(doc_id)
        store.save_history(doc_id, [*history["past"], previous], [])
        return {"id": saved["id"], "updatedAt": saved["updatedAt"], "fields_changed": changed}
