from __future__ import annotations

import json
import pathlib

import pytest

CATALOG_PATH = pathlib.Path(__file__).resolve().parent.parent / "shared" / "ipc-method-catalog.json"


def _catalog() -> dict:
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def test_approval_context_is_declared_only_on_private_agent_calls():
    methods = _catalog()["methods"]
    for method in ("agent_internal_approval_ensure", "agent_internal_dispatch"):
        assert methods[method]["internal"] is True
        assert methods[method]["inputSchema"]["properties"]["context"] == {"type": "object"}


def test_agent_methods_have_explicit_schemas_and_internal_refresh_hides_client_secrets(monkeypatch):
    from backend.core.agent import agent_chat
    from backend.core.integrations import connections
    from backend.core.ipc_catalog import ORCHESTRATABLE_METHODS, input_schema_for
    from backend.handlers import integrations

    methods = _catalog()["methods"]
    from backend.core.agent import agent_tools

    for method in (ORCHESTRATABLE_METHODS | set(agent_chat.gated_methods())) - set(agent_tools.SPECS):
        schema = input_schema_for(method)
        assert schema == methods[method]["inputSchema"]
        assert schema["type"] == "object"
        assert set(schema.get("required", [])) <= schema["properties"].keys()
    assert methods["connections_token_refresh"]["internal"] is True
    monkeypatch.setattr(connections, "fresh_tokens", lambda provider: {
        "access_token": "new", "refresh_token": "rotated", "client_id": "private", "client_secret": "secret",
    })
    result = integrations.HANDLERS["connections_token_refresh"]({"provider": "demo"})
    assert result["tokens"]["refresh_token"] == "rotated"
    assert "client_secret" not in result["tokens"] and "client_id" not in result["tokens"]


def test_flujos_methods_are_retired_and_kept_services_move_to_their_handlers() -> None:
    from backend.core.ipc_catalog import handler_module_for

    methods = _catalog()["methods"]
    assert not [name for name in methods if name.startswith("flows_")]
    assert all("flowCallable" not in entry for entry in methods.values())
    assert handler_module_for("ai_providers_list") == "backend.handlers.integrations"
    assert handler_module_for("connections_token_put") == "backend.handlers.integrations"
    assert handler_module_for("print_pdf") == "backend.handlers.printing"
    assert handler_module_for("printers_list") == "backend.handlers.printing"


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
    assert frozenset({"version", "process_status"}) == SYNC_METHODS
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
        ("print_pdf", 900_000),
        ("html_to_pdf", 900_000),
        ("dialog_folder", 300_000),
    ],
)
def test_catalog_timeout_tiers(method: str, expected_ms: int) -> None:
    catalog = _catalog()
    entry = catalog["methods"][method]
    tier = entry.get("timeout", "normal")
    assert catalog["timeouts"][tier] == expected_ms


def test_agent_conversation_tool_selection_contract() -> None:
    methods = _catalog()["methods"]
    entry = methods["agent_tools_set"]
    assert entry["handler"] == "native:agent"
    assert not entry.get("orchestratable")
    assert entry["inputSchema"]["required"] == ["session_id", "names"]
    assert entry["inputSchema"]["properties"]["names"] == {
        "type": ["array", "null"], "items": {"type": "string"}
    }
    assert methods["agent_tools_list"]["inputSchema"]["properties"]["session_id"] == {
        "type": "string"
    }


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
        if "fileTokens" in entry:
            assert all(
                isinstance(segments, list) and all(isinstance(s, str) for s in segments)
                for segments in entry["fileTokens"]
            ), f"{name}: fileTokens mal formado"
        if "writePathKeys" in entry:
            assert all(
                isinstance(k, str) for k in entry["writePathKeys"]
            ), f"{name}: writePathKeys mal formado"

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
    assert file_tokens_for("print_pdf") == (("pdf_path",),)
    assert not is_idempotent("print_pdf")
    assert is_idempotent("printers_list")
