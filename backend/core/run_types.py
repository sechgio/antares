from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from jsonschema.exceptions import ValidationError

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

def _is_integer(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    return isinstance(value, float) and value.is_integer()


_TYPE_CHECKS = {
    "string": lambda value: isinstance(value, str),
    "integer": _is_integer,
    "boolean": lambda value: isinstance(value, bool),
    "object": lambda value: isinstance(value, dict),
    "array": lambda value: isinstance(value, list),
    "null": lambda value: value is None,
}

_SUPPORTED_SCHEMA_KEYS = frozenset({
    "type",
    "properties",
    "items",
    "minLength",
    "minimum",
    "maximum",
    "minItems",
    "additionalProperties",
})


def _compile_validator(schema: dict[str, Any]) -> Any:
    if not schema:
        return lambda value: None
    unsupported = set(schema) - _SUPPORTED_SCHEMA_KEYS
    if unsupported:
        msg = f"Claves de schema sin soporte en el validador compilado: {sorted(unsupported)}"
        raise ValueError(msg)

    checks = []
    raw_type = schema.get("type")
    if raw_type is not None:
        type_names = (raw_type,) if isinstance(raw_type, str) else tuple(raw_type)
        predicates = tuple(_TYPE_CHECKS[name] for name in type_names)

        def check_type(value: Any, predicates: tuple = predicates, type_names: tuple = type_names) -> None:
            if not any(pred(value) for pred in predicates):
                raise ValidationError(f"{value!r} is not of type {type_names}")

        checks.append(check_type)

    if "minLength" in schema:
        min_length = schema["minLength"]

        def check_min_length(value: Any, min_length: int = min_length) -> None:
            if isinstance(value, str) and len(value) < min_length:
                raise ValidationError(f"{value!r} is too short")

        checks.append(check_min_length)

    if "minimum" in schema:
        minimum = schema["minimum"]

        def check_minimum(value: Any, minimum: float = minimum) -> None:
            if isinstance(value, (int, float)) and not isinstance(value, bool) and value < minimum:
                raise ValidationError(f"{value!r} is less than the minimum of {minimum}")

        checks.append(check_minimum)

    if "maximum" in schema:
        maximum = schema["maximum"]

        def check_maximum(value: Any, maximum: float = maximum) -> None:
            if isinstance(value, (int, float)) and not isinstance(value, bool) and value > maximum:
                raise ValidationError(f"{value!r} is greater than the maximum of {maximum}")

        checks.append(check_maximum)

    if "minItems" in schema:
        min_items = schema["minItems"]

        def check_min_items(value: Any, min_items: int = min_items) -> None:
            if isinstance(value, list) and len(value) < min_items:
                raise ValidationError(f"{value!r} has too few items")

        checks.append(check_min_items)

    items_schema = schema.get("items")
    if items_schema:
        item_validator = _compile_validator(items_schema)

        def check_items(value: Any, item_validator: Any = item_validator) -> None:
            if isinstance(value, list):
                for item in value:
                    item_validator(item)

        checks.append(check_items)

    properties = schema.get("properties")
    if properties:
        compiled_properties = tuple(
            (key, _compile_validator(subschema)) for key, subschema in properties.items()
        )

        def check_properties(value: Any, compiled_properties: tuple = compiled_properties) -> None:
            if isinstance(value, dict):
                for key, property_validator in compiled_properties:
                    if key in value:
                        property_validator(value[key])

        checks.append(check_properties)

    def validate(value: Any, checks: tuple = tuple(checks)) -> None:
        for check in checks:
            check(value)

    return validate


def _compile_registry() -> dict[str, tuple[Any, Any]]:
    return {
        run_type: (
            _compile_validator(meta.options_schema),
            _compile_validator(meta.files_schema),
        )
        for run_type, meta in RUN_TYPE_REGISTRY.items()
    }


_COMPILED_REGISTRY = _compile_registry()


def validate_run_payload(run_type: str, options: Any, files: Any) -> None:
    compiled = _COMPILED_REGISTRY.get(run_type)
    if compiled is None:
        msg = f"Unknown run_type: {run_type!r}. Registered types: {ALL_RUN_TYPES}"
        raise ValueError(msg)

    options_validator, files_validator = compiled
    options_validator(options or {})
    files_validator(files or [])
