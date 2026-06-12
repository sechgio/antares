"""RunType registry: single source of truth for historial run types.

Each registered ``RunType`` declares:

* a stable id (``"conversion"``, ``"formato"``, …)
* an i18n ``label_key`` consumed by the frontend
* a ``color_token`` (CSS variable name) for badges / accents
* a JSON Schema (draft-07) for ``options_json`` and ``files_json`` validation
* a list of stats fields rendered in the run detail panel
* a ``description_key`` for tooltips / docs

Adding a new run type is a one-line change here plus a corresponding
entry in ``frontend/src/components/history/runTypes.ts``. No handler or
component edits required.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

# Optional dependency. Imported lazily to keep the core runtime lean.
try:  # pragma: no cover - exercised in environments where jsonschema is installed
    import jsonschema  # type: ignore

    _JSONSCHEMA_AVAILABLE = True
except ImportError:  # pragma: no cover
    jsonschema = None  # type: ignore[assignment]
    _JSONSCHEMA_AVAILABLE = False
    logger.warning(
        "jsonschema no está instalado; la validación de payloads de historial "
        "queda desactivada. TODO: agregar jsonschema a pyproject.toml."
    )


# ─── Schema fragments ──────────────────────────────────────────────────────
# Reusable JSON Schema pieces. Kept module-private; consumed by RunTypeMeta.

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

# Empty schema used as a permissive fallback (accepts anything). Used for
# the generic "unknown" entry and as a marker that no validation is desired.
_ANY_OBJECT: dict[str, Any] = {"type": "object", "additionalProperties": True}
_ANY_ARRAY: dict[str, Any] = {"type": "array"}


# ─── Registry data model ───────────────────────────────────────────────────

@dataclass(frozen=True)
class StatField:
    """A single stat tile shown in the run detail panel."""

    key: str
    label_key: str
    resolve: Callable[[dict[str, Any]], Any]
    color_token: str | None = None


@dataclass(frozen=True)
class RunTypeMeta:
    """Metadata for a single run type."""

    id: str
    label_key: str
    description_key: str
    color_token: str
    options_schema: dict[str, Any] = field(default_factory=dict)
    files_schema: dict[str, Any] = field(default_factory=dict)
    stats: tuple[StatField, ...] = ()
    show_patron: bool = False
    filter_group: str = "default"  # "default" or "hidden"


# ─── Stats builders ────────────────────────────────────────────────────────
# Each returns a tuple of StatField. Kept in module scope so the registry
# body stays declarative.

def _conversion_stats() -> tuple[StatField, ...]:
    return (
        StatField(
            key="formato",
            label_key="history.stats.format",
            resolve=lambda r: r.get("formato") or "—",
        ),
        StatField(
            key="calidad",
            label_key="history.stats.quality",
            resolve=lambda r: f"{int(r.get('calidad') or 0)}%",
        ),
        StatField(
            key="ok",
            label_key="history.stats.ok",
            resolve=lambda r: r.get("ok_count") or 0,
            color_token="var(--accent-green)",
        ),
        StatField(
            key="err",
            label_key="history.stats.err",
            resolve=lambda r: r.get("err_count") or 0,
            color_token="var(--accent-red)",
        ),
    )


def _formato_stats() -> tuple[StatField, ...]:
    return (
        StatField(
            key="formato",
            label_key="history.stats.format",
            resolve=lambda r: r.get("formato") or "—",
        ),
        StatField(
            key="desde",
            label_key="history.stats.from",
            resolve=lambda r: (r.get("options_json") and _opt(r, "desde")) or "?",
        ),
        StatField(
            key="hasta",
            label_key="history.stats.to",
            resolve=lambda r: (r.get("options_json") and _opt(r, "hasta")) or "?",
        ),
        StatField(
            key="files",
            label_key="history.stats.pages",
            resolve=lambda r: len(_files(r)),
            color_token="var(--accent-primary)",
        ),
    )


def _padron_stats() -> tuple[StatField, ...]:
    return (
        StatField(
            key="formato",
            label_key="history.stats.format",
            resolve=lambda r: r.get("formato") or "—",
        ),
        StatField(
            key="items",
            label_key="history.stats.items",
            resolve=lambda r: len(_files(r)),
            color_token="var(--accent-yellow)",
        ),
        StatField(
            key="ok",
            label_key="history.stats.ok",
            resolve=lambda r: r.get("ok_count") or 0,
            color_token="var(--accent-green)",
        ),
        StatField(
            key="err",
            label_key="history.stats.err",
            resolve=lambda r: r.get("err_count") or 0,
            color_token="var(--accent-red)",
        ),
    )


def _volante_stats() -> tuple[StatField, ...]:
    return (
        StatField(
            key="formato",
            label_key="history.stats.format",
            resolve=lambda r: r.get("formato") or "—",
        ),
        StatField(
            key="records",
            label_key="history.stats.records",
            resolve=lambda r: len(_files(r)),
            color_token="var(--accent-secondary)",
        ),
        StatField(
            key="ok",
            label_key="history.stats.ok",
            resolve=lambda r: r.get("ok_count") or 0,
            color_token="var(--accent-green)",
        ),
        StatField(
            key="err",
            label_key="history.stats.err",
            resolve=lambda r: r.get("err_count") or 0,
            color_token="var(--accent-red)",
        ),
    )


def _image_optimizer_stats() -> tuple[StatField, ...]:
    return (
        StatField(
            key="preset",
            label_key="history.stats.preset",
            resolve=lambda r: _opt(r, "preset") or "custom",
            color_token="var(--accent-purple, #a855f7)",
        ),
        StatField(
            key="scope",
            label_key="history.stats.scope",
            resolve=lambda r: _opt(r, "scope") or "all",
        ),
        StatField(
            key="ok",
            label_key="history.stats.processed",
            resolve=lambda r: r.get("ok_count") or 0,
            color_token="var(--accent-green)",
        ),
        StatField(
            key="err",
            label_key="history.stats.err",
            resolve=lambda r: r.get("err_count") or 0,
            color_token="var(--accent-red)",
        ),
    )


def _sellador_stats() -> tuple[StatField, ...]:
    return (
        StatField(
            key="file",
            label_key="history.stats.file",
            resolve=lambda r: r.get("formato") or "—",
        ),
        StatField(
            key="stamps",
            label_key="history.stats.stamps",
            resolve=lambda r: _opt(r, "stamp_count") or r.get("ok_count") or 0,
            color_token="var(--accent-amber, #fbbf24)",
        ),
        StatField(
            key="pages",
            label_key="history.stats.pagesStamped",
            resolve=lambda r: _opt(r, "stamped_pages") or "—",
        ),
        StatField(
            key="seed",
            label_key="history.stats.seed",
            resolve=lambda r: _opt(r, "seed") or "—",
        ),
    )


def _reporte_campo_stats() -> tuple[StatField, ...]:
    return (
        StatField(
            key="cs",
            label_key="history.stats.cs",
            resolve=lambda r: _opt(r, "cs") or "—",
        ),
        StatField(
            key="contratista",
            label_key="history.stats.contractor",
            resolve=lambda r: _opt(r, "contratista") or "—",
        ),
        StatField(
            key="ok",
            label_key="history.stats.ok",
            resolve=lambda r: r.get("ok_count") or 0,
            color_token="var(--accent-green)",
        ),
        StatField(
            key="err",
            label_key="history.stats.err",
            resolve=lambda r: r.get("err_count") or 0,
            color_token="var(--accent-red)",
        ),
    )


def _panel_aviso_corte_stats() -> tuple[StatField, ...]:
    return (
        StatField(
            key="strategy",
            label_key="history.stats.strategy",
            resolve=lambda r: _opt(r, "strategy") or "—",
        ),
        StatField(
            key="key",
            label_key="history.stats.keyColumn",
            resolve=lambda r: _opt(r, "key_column") or "—",
        ),
        StatField(
            key="ok",
            label_key="history.stats.panels",
            resolve=lambda r: r.get("ok_count") or 0,
            color_token="var(--accent-rose, #fb7185)",
        ),
        StatField(
            key="err",
            label_key="history.stats.err",
            resolve=lambda r: r.get("err_count") or 0,
            color_token="var(--accent-red)",
        ),
    )


def _informe_tecnico_stats() -> tuple[StatField, ...]:
    return (
        StatField(
            key="cs",
            label_key="history.stats.cs",
            resolve=lambda r: _opt(r, "cs") or "—",
        ),
        StatField(
            key="contratista",
            label_key="history.stats.contractor",
            resolve=lambda r: _opt(r, "contratista") or "—",
        ),
        StatField(
            key="status",
            label_key="history.stats.status",
            resolve=lambda r: _opt(r, "status") or "—",
        ),
        StatField(
            key="ok",
            label_key="history.stats.ok",
            resolve=lambda r: r.get("ok_count") or 0,
            color_token="var(--accent-cyan, #22d3ee)",
        ),
    )


# ─── Helpers used by stats builders ────────────────────────────────────────

def _opt(run: dict[str, Any], key: str) -> Any:
    """Return ``options_json[key]`` or ``None``. Tolerates non-JSON / missing keys."""
    import json

    raw = run.get("options_json")
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if isinstance(data, dict):
        return data.get(key)
    return None


def _files(run: dict[str, Any]) -> list[str]:
    """Return ``files_json`` parsed as a list. Tolerates non-JSON / missing keys."""
    import json

    raw = run.get("files_json")
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return []
    return data if isinstance(data, list) else []


# ─── Registry ──────────────────────────────────────────────────────────────

RUN_TYPE_REGISTRY: dict[str, RunTypeMeta] = {
    "conversion": RunTypeMeta(
        id="conversion",
        label_key="history.runTypes.conversion",
        description_key="history.runTypes.conversionDesc",
        color_token="var(--accent-green)",
        options_schema=_CONVERSION_OPTIONS_SCHEMA,
        files_schema=_NON_EMPTY_STRING_ARRAY,
        stats=_conversion_stats(),
        show_patron=True,
    ),
    "formato": RunTypeMeta(
        id="formato",
        label_key="history.runTypes.formato",
        description_key="history.runTypes.formatoDesc",
        color_token="var(--accent-primary)",
        options_schema=_FORMATO_OPTIONS_SCHEMA,
        files_schema=_ANY_ARRAY,
        stats=_formato_stats(),
    ),
    "sellador": RunTypeMeta(
        id="sellador",
        label_key="history.runTypes.sellador",
        description_key="history.runTypes.selladorDesc",
        color_token="var(--accent-amber, #fbbf24)",
        options_schema=_SELLADOR_OPTIONS_SCHEMA,
        files_schema=_ANY_ARRAY,
        stats=_sellador_stats(),
    ),
    "padron": RunTypeMeta(
        id="padron",
        label_key="history.runTypes.padron",
        description_key="history.runTypes.padronDesc",
        color_token="var(--accent-yellow)",
        options_schema=_PADRON_OPTIONS_SCHEMA,
        files_schema=_ANY_ARRAY,
        stats=_padron_stats(),
    ),
    "volante": RunTypeMeta(
        id="volante",
        label_key="history.runTypes.volante",
        description_key="history.runTypes.volanteDesc",
        color_token="var(--accent-secondary)",
        options_schema=_VOLANTE_OPTIONS_SCHEMA,
        files_schema=_ANY_ARRAY,
        stats=_volante_stats(),
    ),
    "image_optimizer": RunTypeMeta(
        id="image_optimizer",
        label_key="history.runTypes.imageOptimizer",
        description_key="history.runTypes.imageOptimizerDesc",
        color_token="var(--accent-purple, #a855f7)",
        options_schema=_IMAGE_OPTIMIZER_OPTIONS_SCHEMA,
        files_schema=_ANY_ARRAY,
        stats=_image_optimizer_stats(),
    ),
    "reporte_campo": RunTypeMeta(
        id="reporte_campo",
        label_key="history.runTypes.reporteCampo",
        description_key="history.runTypes.reporteCampoDesc",
        color_token="var(--accent-orange, #fb923c)",
        options_schema=_REPORTE_CAMPO_OPTIONS_SCHEMA,
        files_schema=_ANY_ARRAY,
        stats=_reporte_campo_stats(),
    ),
    "panel_aviso_corte": RunTypeMeta(
        id="panel_aviso_corte",
        label_key="history.runTypes.panelAvisoCorte",
        description_key="history.runTypes.panelAvisoCorteDesc",
        color_token="var(--accent-rose, #fb7185)",
        options_schema=_PANEL_AVISO_CORTE_OPTIONS_SCHEMA,
        files_schema=_ANY_ARRAY,
        stats=_panel_aviso_corte_stats(),
    ),
    "informe_tecnico": RunTypeMeta(
        id="informe_tecnico",
        label_key="history.runTypes.informeTecnico",
        description_key="history.runTypes.informeTecnicoDesc",
        color_token="var(--accent-cyan, #22d3ee)",
        options_schema=_INFORME_TECNICO_OPTIONS_SCHEMA,
        files_schema=_ANY_ARRAY,
        stats=_informe_tecnico_stats(),
    ),
}

ALL_RUN_TYPES: list[str] = list(RUN_TYPE_REGISTRY.keys())

UNKNOWN_RUN_TYPE: RunTypeMeta = RunTypeMeta(
    id="unknown",
    label_key="history.runTypes._unknown",
    description_key="history.runTypes._unknown",
    color_token="var(--text-muted)",
    options_schema=_ANY_OBJECT,
    files_schema=_ANY_ARRAY,
    stats=(),
    filter_group="hidden",
)


def get_run_type(run_type: str) -> RunTypeMeta:
    """Return the metadata for ``run_type`` or a permissive ``UNKNOWN_RUN_TYPE`` fallback."""
    return RUN_TYPE_REGISTRY.get(run_type) or UNKNOWN_RUN_TYPE


def validate_run_payload(run_type: str, options: Any, files: Any) -> None:
    """Validate a payload against the registry schema. Raises ``ValueError`` for unknown types.

    Behavior when ``jsonschema`` is not installed: logs a warning and returns
    without raising (degraded validation). The run is then persisted with
    ``schema_version=0`` to mark it as "unvalidated".
    """
    meta = RUN_TYPE_REGISTRY.get(run_type)
    if meta is None:
        msg = f"Unknown run_type: {run_type!r}. Registered types: {ALL_RUN_TYPES}"
        raise ValueError(msg)

    if not _JSONSCHEMA_AVAILABLE:
        # FIXME: agregar jsonschema a pyproject.toml para validación estricta.
        return

    if meta.options_schema:
        jsonschema.validate(instance=options or {}, schema=meta.options_schema)  # type: ignore[union-attr]
    if meta.files_schema:
        jsonschema.validate(instance=files or [], schema=meta.files_schema)  # type: ignore[union-attr]


def registry_payload() -> dict[str, Any]:
    """Return a JSON-serializable snapshot of the registry (consumed by the frontend)."""
    return {
        "run_types": [
            {
                "id": meta.id,
                "label_key": meta.label_key,
                "description_key": meta.description_key,
                "color_token": meta.color_token,
                "show_patron": meta.show_patron,
                "filter_group": meta.filter_group,
                "options_schema": meta.options_schema,
                "files_schema": meta.files_schema,
                "stats": [
                    {
                        "key": stat.key,
                        "label_key": stat.label_key,
                        "color_token": stat.color_token,
                    }
                    for stat in meta.stats
                ],
            }
            for meta in RUN_TYPE_REGISTRY.values()
        ],
        "all_run_types": ALL_RUN_TYPES,
    }
