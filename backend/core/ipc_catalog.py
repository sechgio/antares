from __future__ import annotations

import json
from typing import Any

from backend.utils.paths import resource_path

_CATALOG_PATH = resource_path("shared/ipc-method-catalog.json")
_CATALOG: dict[str, Any] = json.loads(  # allowlist: dict[str, Any]
    _CATALOG_PATH.read_text(encoding="utf-8")
)
_METHODS: dict[str, dict[str, Any]] = _CATALOG["methods"]  # allowlist: dict[str, Any]


def _entry(method: str) -> dict[str, Any] | None:  # allowlist: dict[str, Any]
    entry = _METHODS.get(method)
    return entry if isinstance(entry, dict) else None


def handler_module_for(method: str) -> str | None:
    entry = _entry(method)
    if entry is None:
        return None
    handler = entry.get("handler")
    if isinstance(handler, str) and handler.startswith("backend:"):
        return f"backend.handlers.{handler[len('backend:'):]}"
    return None


def lane_for(method: str) -> str:
    entry = _entry(method)
    if entry is None or not str(entry.get("handler", "")).startswith("backend:"):
        return "light"
    lane = entry.get("lane")
    return lane if isinstance(lane, str) else "light"


BACKEND_HANDLER_MODULES: frozenset[str] = frozenset(
    mod for mod in (handler_module_for(name) for name in _METHODS) if mod is not None
)

HEAVY_METHODS: frozenset[str] = frozenset(
    name for name, entry in _METHODS.items() if entry.get("lane") == "heavy"
)
SYNC_METHODS: frozenset[str] = frozenset(
    name for name, entry in _METHODS.items() if entry.get("lane") == "sync"
)
IDEMPOTENT_METHODS: frozenset[str] = frozenset(
    name for name, entry in _METHODS.items() if entry.get("idempotent") is True
)
RAW_OUTPUT_PATH_METHODS: frozenset[str] = frozenset(
    name for name, entry in _METHODS.items() if entry.get("rawOutputPath") is True
)
