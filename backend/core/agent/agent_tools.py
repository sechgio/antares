from __future__ import annotations

from typing import TYPE_CHECKING, Any

from backend.core.agent import (
    artifacts,
    canvas_edit,
    computer_desktop,
    computer_files,
    computer_shell,
    documents,
    drafts,
    memory,
    questions,
    skills,
    task_plan,
)
from backend.core.integrations import mcp_servers
from backend.core.integrations.types import JsonObject

if TYPE_CHECKING:
    from backend.core.agent.agent import AgentStore

SPECS: dict[str, JsonObject] = {
    spec["name"]: spec
    for spec in (*drafts.TOOL_SPECS, *({**s, "module": "documents"} for s in documents.TOOL_SPECS),
                 *canvas_edit.TOOL_SPECS, *artifacts.TOOL_SPECS, *questions.TOOL_SPECS, *memory.TOOL_SPECS,
                 *computer_files.TOOL_SPECS, *computer_shell.TOOL_SPECS, *computer_desktop.TOOL_SPECS,
                 *task_plan.TOOL_SPECS, *skills.TOOL_SPECS)
}
SPECS["mcp_status"] = {
    "name": "mcp_status", "module": "connections", "gated": False,
    "description": "Conexiones · mcp_status (solo lectura): consulta servidores MCP configurados, última comprobación y errores sin secretos. "
                   "refresh=true vuelve a consultar sus catálogos; no modifica configuración ni credenciales.",
    "inputSchema": {"type": "object", "properties": {"refresh": {"type": "boolean"}}},
}
READ_TOOLS = frozenset(name for name, spec in SPECS.items() if not spec["gated"])
EFFECT_TOOLS = frozenset(name for name, spec in SPECS.items() if spec["gated"])


def run(name: str, args: JsonObject, store: AgentStore, session_id: str, token: Any = None,
        *, profile_id: str | None = None) -> JsonObject:
    root = store.drafts_dir(session_id)
    if name == "mcp_status":
        return {"servers": mcp_servers.server_statuses(refresh=args.get("refresh") is True)}
    if name in {"skills_list", "skills_read"}:
        return skills.run(name, args, store.grants_for(session_id), root, store.base_dir / "skills", agent_id=profile_id)
    if name.startswith("fs_"):
        return computer_files.fit(computer_files.run(name, args, store.grants_for(session_id), root))
    if name == "shell_run":
        return computer_files.fit(computer_shell.run(args, store.grants_for(session_id), root, token))
    if name == "shell_output":
        return computer_shell.read_output(args, root)
    if name.startswith("desktop_"):
        return computer_desktop.run(name, args, root, token)
    if name == "task_plan":
        return task_plan.update(args)
    if name == "drafts_list":
        return drafts.list_drafts(root)
    if name == "drafts_save":
        return drafts.save_draft(root, args)
    if name == "templates_catalog":
        family = args.get("family")
        return documents.catalog(str(family) if family else None)
    if name == "template_describe":
        return documents.describe(args)
    if name == "document_prepare":
        return documents.prepare(args, store.grants_for(session_id), root)
    if name == "document_generate":
        result, artifact = documents.generate(args, store.grants_for(session_id), root)
        if artifact is not None:
            result["artifact"] = store.add_artifact(session_id, artifact)
        return result
    if name == "file_read":
        return documents.read_file(args, store.grants_for(session_id), root)
    if name == "canvas_fill_fields":
        return canvas_edit.fill_fields(args)
    if name == "canvas_apply_layers":
        return canvas_edit.apply_layers(args)
    if name == "artifacts_list":
        return {"artifacts": store.artifacts_for(session_id)}
    if name in {"memory_search", "memory_remember", "procedure_learn"}:
        return memory.run(name, args, store, session_id)
    raise ValueError(f"Herramienta no disponible para el agente: {name}")
