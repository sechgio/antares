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
        "evidenciaVolanteo", "autoimg", "fichasTecnicas", "espacios", "connections", "design", "agenda",
    }
    extra = {"conversion", "printing", "history", "app", "drafts", "documents", "computer"}
    assert set(modules.catalog()) <= navigation | extra


def test_tool_specs_carry_module_and_spanish_label():
    specs = {s["name"]: s for s in agent_chat.tool_specs()}
    assert specs["sellador_apply"]["module"] == "sellador"
    assert specs["sellador_apply"]["description"].startswith("Sellador · ")
    assert specs["sellador_inspect_pdf"]["gated"] is False
    assert specs["formatos_generate"]["gated"] is True
    assert specs["is_video"]["module"] == "conversion"
    assert specs["is_video"]["gated"] is False
    assert specs["design_memory_update"]["gated"] is True


def test_mentions_resolve_aliases_accents_and_ignore_emails():
    result = modules.resolve_mentions("Usa @sellador y @Padrón; escribe a ana@correo.com y @inexistente")
    assert result["modules"] == ["sellador", "padron"]
    assert result["unknown"] == ["inexistente"]
    assert modules.resolve_mentions("sin menciones")["modules"] == []


def test_mention_context_lists_tools_and_unavailable_reasons():
    out = agent_internal.HANDLERS["agent_internal_mentions"](
        {"text": "Usa @sellador, @autoimg y @espacios", "native_tools": ["autoimg_status", "espacios_list"]}
    )
    assert out["modules"] == ["sellador", "autoimg", "espacios"]
    assert "sellador_apply" in out["context"] and "sellador_inspect_pdf" in out["context"]
    assert "AutoIMG: herramientas autoimg_status" in out["context"]
    assert "Espacios: herramientas espacios_list" in out["context"]
    assert "context" not in agent_internal.HANDLERS["agent_internal_mentions"]({"text": "hola"})


def test_connector_mentions_enable_every_connection_tool():
    assert modules.resolve_mentions("usa @gmail, @outlook, @github y @correo")["modules"] == ["connections"]
    context = modules.mention_context(["connections"], ["gdrive_search", "gmail_search", "outlook_get",
                                                        "github_run_get", "mcp_status"])
    assert "gdrive_search, gmail_search, outlook_get, github_run_get, mcp_status" in context


def test_mcp_server_mentions_load_enabled_tools_and_report_failures(monkeypatch):
    from backend.core.integrations import mcp_servers

    monkeypatch.setattr(mcp_servers, "list_servers", lambda: [
        {"id": "srv-a", "name": "Mi Servidor"}, {"id": "srv-b", "name": "Caído"}, {"id": "srv-c", "name": "Otro"}])

    def list_tools(server_id):
        if server_id == "srv-b":
            raise OSError("token=secreto")
        return [{"name": "buscar", "enabled": True}, {"name": "borrar", "enabled": False}]

    monkeypatch.setattr(mcp_servers, "list_tools", list_tools)
    out = agent_internal.HANDLERS["agent_internal_mentions"]({"text": "Usa @mi-servidor, @caido y @nadie"})
    assert out["modules"] == [] and out["unknown"] == ["nadie"]
    assert out["mcp_tools"] == [mcp_servers.agent_tool_name("srv-a", "buscar")]
    assert f"Mi Servidor: herramientas {out['mcp_tools'][0]}" in out["context"]
    assert "Caído: no disponible" in out["context"] and "secreto" not in out["context"]
    assert "borrar" not in out["context"]


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
