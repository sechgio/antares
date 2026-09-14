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


def test_catalog_does_not_register_retired_methods() -> None:
    from backend.handlers import _RETIRED_METHODS

    catalog = _catalog()
    overlap = _RETIRED_METHODS & set(catalog["methods"])
    assert not overlap, f"métodos retirados presentes en el catálogo: {sorted(overlap)}"


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
    from backend.core.ipc_catalog import (
        IDEMPOTENT_METHODS,
        RAW_OUTPUT_PATH_METHODS,
        allows_raw_output_path,
        file_tokens_for,
        is_idempotent,
        is_native,
        timeout_ms_for,
        write_path_keys_for,
    )

    catalog = _catalog()
    methods = catalog["methods"]

    for name, entry in methods.items():
        tier = entry.get("timeout", "normal")
        assert timeout_ms_for(name) == catalog["timeouts"][tier]
        assert is_idempotent(name) == (entry.get("idempotent") is True)
        assert is_native(name) == str(entry.get("handler", "")).startswith("native:")
        assert allows_raw_output_path(name) == (entry.get("rawOutputPath") is True)

        expected_tokens = tuple(
            tuple(str(s) for s in segments) for segments in entry.get("fileTokens", [])
        )
        assert file_tokens_for(name) == expected_tokens

        expected_write_keys = frozenset(entry.get("writePathKeys", []))
        assert write_path_keys_for(name) == expected_write_keys

    assert frozenset(
        name for name, entry in methods.items() if entry.get("idempotent") is True
    ) == IDEMPOTENT_METHODS
    assert frozenset(
        name for name, entry in methods.items() if entry.get("rawOutputPath") is True
    ) == RAW_OUTPUT_PATH_METHODS

    assert timeout_ms_for("metodo_inexistente") == catalog["timeouts"]["normal"]
    assert file_tokens_for("version") == ()
    assert write_path_keys_for("process_start") == frozenset({"destino"})
    assert file_tokens_for("canvas_export_cmyk_pdf") == (("localImagePaths", "*"),)
