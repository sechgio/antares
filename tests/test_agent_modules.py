"""Módulos y menciones del agente: cobertura de herramientas y resolución de @alias."""

from __future__ import annotations

from backend.core.agent import agent_chat, modules
from backend.core.ipc_catalog import ORCHESTRATABLE_METHODS
from backend.handlers import agent_internal


def test_every_agent_tool_belongs_to_a_module():
    methods = sorted(ORCHESTRATABLE_METHODS) + agent_chat.gated_methods()
    missing = [m for m in methods if modules.module_for(m) is None]
    assert missing == []


def test_module_ids_match_navigation_or_known_groups():
    navigation = {
        "convert", "formatos", "sellador", "padron", "volantes", "reportesCampo", "technicalReports",
        "informesV2", "imageOptimizer", "previewPanel", "canvas", "agent", "panelAvisoCorte", "ubicaciones",
        "evidenciaVolanteo", "autoimg", "fichasTecnicas", "espacios", "connections",
    }
    extra = {"conversion", "printing", "history", "app"}
    assert set(modules.catalog()) <= navigation | extra


def test_tool_specs_carry_module_and_spanish_label():
    specs = {s["name"]: s for s in agent_chat.tool_specs()}
    assert specs["sellador_apply"]["module"] == "sellador"
    assert specs["sellador_apply"]["description"].startswith("Sellador · ")
    assert specs["sellador_inspect_pdf"]["gated"] is False
    assert specs["formatos_generate"]["gated"] is True


def test_mentions_resolve_aliases_accents_and_ignore_emails():
    result = modules.resolve_mentions("Usa @sellador y @Padrón; escribe a ana@correo.com y @inexistente")
    assert result["modules"] == ["sellador", "padron"]
    assert result["unknown"] == ["inexistente"]
    assert modules.resolve_mentions("sin menciones")["modules"] == []


def test_mention_context_lists_tools_and_unavailable_reasons():
    out = agent_internal.HANDLERS["agent_internal_mentions"]({"text": "Usa @sellador y @autoimg"})
    assert out["modules"] == ["sellador", "autoimg"]
    assert "sellador_apply" in out["context"] and "sellador_inspect_pdf" in out["context"]
    assert "AutoIMG: no disponible" in out["context"]
    assert "context" not in agent_internal.HANDLERS["agent_internal_mentions"]({"text": "hola"})


def test_aliases_are_unique_across_modules():
    seen: dict[str, str] = {}
    clashes = []
    for module_id, spec in modules.catalog().items():
        for alias in [module_id, spec["label"], *spec.get("aliases", [])]:
            key = modules._normal(str(alias))
            if seen.get(key, module_id) != module_id:
                clashes.append((alias, seen[key], module_id))
            seen[key] = module_id
    assert clashes == []


def test_configuration_and_internal_channels_are_not_agent_tools():
    names = {s["name"] for s in agent_chat.tool_specs()}
    for method in ("ai_providers_list", "ai_provider_save", "mcp_servers_list", "mcp_server_tools",
                   "mcp_server_add", "telemetry", "connections_token_refresh", "db_clear"):
        assert method not in names
