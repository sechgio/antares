from __future__ import annotations

import json
import pathlib

import pytest

CATALOG_PATH = pathlib.Path(__file__).resolve().parent.parent / "shared" / "ipc-method-catalog.json"


def _catalog() -> dict:
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def test_catalog_backend_methods_match_handler_registry() -> None:
    from backend.core.ipc_catalog import handler_module_for
    from backend.handlers import _HANDLER_MODULES, HANDLERS

    catalog = _catalog()
    backend_methods = {
        name
        for name, entry in catalog["methods"].items()
        if str(entry.get("handler", "")).startswith("backend:")
    }

    for method in sorted(backend_methods):
        module = handler_module_for(method)
        assert module is not None, f"{method} sin módulo de handler"
        assert module in _HANDLER_MODULES, f"{method} → {module} no está en _HANDLER_MODULES"

    registry_methods = set(HANDLERS.keys())
    assert registry_methods == backend_methods, (
        f"registry vs catalog drift: "
        f"registry_only={sorted(registry_methods - backend_methods)} "
        f"catalog_only={sorted(backend_methods - registry_methods)}"
    )


def test_lane_and_handler_projections() -> None:
    from backend.core.ipc_catalog import HEAVY_METHODS, SYNC_METHODS, handler_module_for, lane_for

    assert lane_for("canvas_export_cmyk_pdf") == "heavy"
    assert lane_for("process_start") == "light"
    assert lane_for("version") == "sync"
    assert lane_for("html_to_pdf") == "light"  # método nativo: sin lane de backend
    assert lane_for("metodo_inexistente") == "light"

    assert handler_module_for("canvas_get") == "backend.handlers.canvas"
    assert handler_module_for("html_to_pdf") is None
    assert handler_module_for("autoimg_scan_all") is None

    assert "process_start" not in HEAVY_METHODS
    assert "canvas_export_cmyk_pdf" in HEAVY_METHODS
    assert frozenset({"version", "process_status", "diagnostics_snapshot"}) == SYNC_METHODS
    assert SYNC_METHODS.isdisjoint(HEAVY_METHODS)


def test_catalog_declares_only_known_timeout_tiers() -> None:
    catalog = _catalog()
    tiers = set(catalog["timeouts"])
    assert tiers == {"normal", "long", "heavy"}
    for name, entry in catalog["methods"].items():
        tier = entry.get("timeout", "normal")
        assert tier in tiers, f"{name}: timeout tier desconocido {tier}"


@pytest.mark.parametrize(
    "method,expected_ms",
    [
        ("version", 30_000),
        ("db_import", 300_000),
        ("process_start", 900_000),
        ("canvas_export_cmyk_pdf", 900_000),
        ("html_to_pdf", 900_000),
        ("dialog_folder", 300_000),
    ],
)
def test_catalog_timeout_tiers(method: str, expected_ms: int) -> None:
    catalog = _catalog()
    entry = catalog["methods"][method]
    tier = entry.get("timeout", "normal")
    assert catalog["timeouts"][tier] == expected_ms


def test_catalog_full_projection_matches_json() -> None:
    from backend.core.ipc_catalog import IDEMPOTENT_METHODS, RAW_OUTPUT_PATH_METHODS

    methods = _catalog()["methods"]

    for name, entry in methods.items():
        if "fileTokens" in entry:
            assert all(
                isinstance(segments, list) and all(isinstance(s, str) for s in segments)
                for segments in entry["fileTokens"]
            ), f"{name}: fileTokens mal formado"
        if "writePathKeys" in entry:
            assert all(
                isinstance(k, str) for k in entry["writePathKeys"]
            ), f"{name}: writePathKeys mal formado"

    assert frozenset(
        name for name, entry in methods.items() if entry.get("idempotent") is True
    ) == IDEMPOTENT_METHODS
    assert frozenset(
        name for name, entry in methods.items() if entry.get("rawOutputPath") is True
    ) == RAW_OUTPUT_PATH_METHODS

    assert methods["process_start"]["writePathKeys"] == ["destino"]
    assert methods["canvas_export_cmyk_pdf"]["fileTokens"] == [["localImagePaths", "*"]]
