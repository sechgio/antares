"""Edición controlada de documentos de Canvas por el agente.

El agente no escribe documentos JSON completos: solo rellena el valor de capas
de campo que ya existen (``meta.key``) y guarda contra la revisión que leyó
(``expected_updated_at``). Si el documento cambió entretanto —por el editor o
por la sincronización— el guardado falla con un conflicto visible y nada se
sobrescribe.
"""

from __future__ import annotations

from typing import Any

from backend.core.integrations.types import JsonObject

TOOL_SPECS: list[JsonObject] = [
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
    for layer in document["layers"]:
        key = (layer.get("meta") or {}).get("key") if layer.get("type") == "field" else None
        if key is not None and str(key) in values:
            layer["value"] = "" if values[str(key)] is None else str(values[str(key)])
            changed += 1
    saved = store.save(document, expected_updated_at=expected)
    return {"id": saved["id"], "updatedAt": saved["updatedAt"], "fields_changed": changed}
