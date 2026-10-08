
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import jsonschema  # type: ignore

logger = logging.getLogger(__name__)


_NON_EMPTY_STRING_ARRAY: dict[str, Any] = {
    "type": "array",
    "items": {"type": "string", "minLength": 1},
    "minItems": 1,
}

_CONVERSION_OPTIONS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": True,
    "properties": {
        "formato": {"type": "string"},
        "calidad": {"type": "integer", "minimum": 1, "maximum": 100},
        "resize": {"type": ["string", "null"]},
        "keep_exif": {"type": "boolean"},
    },
}

_FORMATO_OPTIONS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": True,
    "properties": {
        "desde": {"type": "integer", "minimum": 1},
        "hasta": {"type": "integer", "minimum": 1},
        "format_id": {"type": "string", "minLength": 1},
    },
}

_PADRON_OPTIONS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": True,
    "properties": {
        "excel_path": {"type": "string"},
        "filtro": {"type": "string"},
    },
}

_VOLANTE_OPTIONS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": True,
    "properties": {
        "excel_path": {"type": "string"},
        "plantilla": {"type": "string"},
    },
}

_IMAGE_OPTIMIZER_OPTIONS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": True,
    "properties": {
        "preset": {"type": "string"},
        "scope": {"type": "string"},
        "max_kb": {"type": "integer", "minimum": 1},
    },
}

_SELLADOR_OPTIONS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": True,
    "properties": {
        "stamp_count": {"type": "integer", "minimum": 1},
        "stamped_pages": {
            "type": "array",
            "items": {"type": "integer", "minimum": 1},
        },
        "seed": {"type": "integer"},
    },
}

_REPORTE_CAMPO_OPTIONS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": True,
    "properties": {
        "cs": {"type": "string"},
        "contratista": {"type": "string"},
    },
}

_PANEL_AVISO_CORTE_OPTIONS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": True,
    "properties": {
        "key_column": {"type": "string"},
        "strategy": {"type": "string"},
        "template": {"type": "string"},
    },
}

_EVIDENCIA_VOLANTEO_OPTIONS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": True,
    "properties": {
        "format": {"type": "string"},
        "pages": {"type": "integer", "minimum": 1},
        "images": {"type": "integer", "minimum": 0},
    },
}

_INFORME_TECNICO_OPTIONS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": True,
    "properties": {
        "cs": {"type": "string"},
        "contratista": {"type": "string"},
        "status": {"type": "string"},
    },
}

_INFORME_V2_OPTIONS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": True,
    "properties": {
        "type": {"type": "string"},
        "reportId": {},
        "count": {"type": "integer", "minimum": 0},
    },
}

_FICHA_TECNICA_OPTIONS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": True,
    "properties": {
        "type": {"type": "string"},
        "fichaId": {},
    },
}

_ANY_ARRAY: dict[str, Any] = {"type": "array"}


@dataclass(frozen=True)
class RunTypeMeta:

    id: str
    label_key: str
    color_token: str
    options_schema: dict[str, Any] = field(default_factory=dict)
    files_schema: dict[str, Any] = field(default_factory=dict)


RUN_TYPE_REGISTRY: dict[str, RunTypeMeta] = {
    "conversion": RunTypeMeta(
        id="conversion",
        label_key="history.runTypes.conversion",
        color_token="var(--accent-green)",
        options_schema=_CONVERSION_OPTIONS_SCHEMA,
        files_schema=_NON_EMPTY_STRING_ARRAY,
    ),
    "formato": RunTypeMeta(
        id="formato",
        label_key="history.runTypes.formato",
        color_token="var(--accent-primary)",
        options_schema=_FORMATO_OPTIONS_SCHEMA,
        files_schema=_ANY_ARRAY,
    ),
    "sellador": RunTypeMeta(
        id="sellador",
        label_key="history.runTypes.sellador",
        color_token="var(--accent-amber, #fbbf24)",
        options_schema=_SELLADOR_OPTIONS_SCHEMA,
        files_schema=_ANY_ARRAY,
    ),
    "padron": RunTypeMeta(
        id="padron",
        label_key="history.runTypes.padron",
        color_token="var(--accent-yellow)",
        options_schema=_PADRON_OPTIONS_SCHEMA,
        files_schema=_ANY_ARRAY,
    ),
    "volante": RunTypeMeta(
        id="volante",
        label_key="history.runTypes.volante",
        color_token="var(--accent-secondary)",
        options_schema=_VOLANTE_OPTIONS_SCHEMA,
        files_schema=_ANY_ARRAY,
    ),
    "image_optimizer": RunTypeMeta(
        id="image_optimizer",
        label_key="history.runTypes.imageOptimizer",
        color_token="var(--accent-purple, #a855f7)",
        options_schema=_IMAGE_OPTIMIZER_OPTIONS_SCHEMA,
        files_schema=_ANY_ARRAY,
    ),
    "reporte_campo": RunTypeMeta(
        id="reporte_campo",
        label_key="history.runTypes.reporteCampo",
        color_token="var(--accent-orange, #fb923c)",
        options_schema=_REPORTE_CAMPO_OPTIONS_SCHEMA,
        files_schema=_ANY_ARRAY,
    ),
    "panel_aviso_corte": RunTypeMeta(
        id="panel_aviso_corte",
        label_key="history.runTypes.panelAvisoCorte",
        color_token="var(--accent-rose, #fb7185)",
        options_schema=_PANEL_AVISO_CORTE_OPTIONS_SCHEMA,
        files_schema=_ANY_ARRAY,
    ),
    "evidencia_volanteo": RunTypeMeta(
        id="evidencia_volanteo",
        label_key="history.runTypes.evidenciaVolanteo",
        color_token="var(--accent-teal, #2dd4bf)",
        options_schema=_EVIDENCIA_VOLANTEO_OPTIONS_SCHEMA,
        files_schema=_ANY_ARRAY,
    ),
    "informe_tecnico": RunTypeMeta(
        id="informe_tecnico",
        label_key="history.runTypes.informeTecnico",
        color_token="var(--accent-cyan, #22d3ee)",
        options_schema=_INFORME_TECNICO_OPTIONS_SCHEMA,
        files_schema=_ANY_ARRAY,
    ),
    "informe_v2": RunTypeMeta(
        id="informe_v2",
        label_key="history.runTypes.informeV2",
        color_token="var(--accent-sky, #38bdf8)",
        options_schema=_INFORME_V2_OPTIONS_SCHEMA,
        files_schema=_ANY_ARRAY,
    ),
    "ficha_tecnica": RunTypeMeta(
        id="ficha_tecnica",
        label_key="history.runTypes.fichaTecnica",
        color_token="var(--accent-teal, #2dd4bf)",
        options_schema=_FICHA_TECNICA_OPTIONS_SCHEMA,
        files_schema=_ANY_ARRAY,
    ),
}

ALL_RUN_TYPES: list[str] = list(RUN_TYPE_REGISTRY.keys())

def validate_run_payload(run_type: str, options: Any, files: Any) -> None:
    meta = RUN_TYPE_REGISTRY.get(run_type)
    if meta is None:
        msg = f"Unknown run_type: {run_type!r}. Registered types: {ALL_RUN_TYPES}"
        raise ValueError(msg)

    if meta.options_schema:
        jsonschema.validate(instance=options or {}, schema=meta.options_schema)
    if meta.files_schema:
        jsonschema.validate(instance=files or [], schema=meta.files_schema)
