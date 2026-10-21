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
    task_plan,
)
from backend.core.integrations.types import JsonObject

if TYPE_CHECKING:
    from backend.core.agent.agent import AgentStore

SPECS: dict[str, JsonObject] = {
    spec["name"]: spec
    for spec in (*drafts.TOOL_SPECS, *({**s, "module": "documents"} for s in documents.TOOL_SPECS),
                 *canvas_edit.TOOL_SPECS, *artifacts.TOOL_SPECS, *questions.TOOL_SPECS, *memory.TOOL_SPECS,
                 *computer_files.TOOL_SPECS, *computer_shell.TOOL_SPECS, *computer_desktop.TOOL_SPECS,
                 *task_plan.TOOL_SPECS)
}
READ_TOOLS = frozenset(name for name, spec in SPECS.items() if not spec["gated"])
EFFECT_TOOLS = frozenset(name for name, spec in SPECS.items() if spec["gated"])


def run(name: str, args: JsonObject, store: AgentStore, session_id: str, token: Any = None) -> JsonObject:
    root = store.drafts_dir(session_id)
    if name.startswith("fs_"):
        return computer_files.fit(computer_files.run(name, args, store.grants_for(session_id), root))
    if name == "shell_run":
        return computer_files.fit(computer_shell.run(args, store.grants_for(session_id), root, token))
    if name.startswith("desktop_"):
        return computer_desktop.run(name, args, root)
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
    if name == "artifacts_list":
        return {"artifacts": store.artifacts_for(session_id)}
    if name in {"memory_search", "memory_remember", "procedure_learn"}:
        return memory.run(name, args, store, session_id)
    raise ValueError(f"Herramienta no disponible para el agente: {name}")
