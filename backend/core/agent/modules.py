from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache

from backend.core.integrations.types import JsonObject
from backend.core.ipc_catalog import handler_module_for
from backend.utils.paths import resource_path

_MENTION_RE = re.compile(r"(?<![\w@])@([\w\-áéíóúñü]+)", re.IGNORECASE)


def _normal(text: str) -> str:
    folded = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().casefold()
    return re.sub(r"[\s_]+", "-", folded.strip())


@lru_cache(maxsize=1)
def catalog() -> dict[str, JsonObject]:
    data = json.loads(resource_path("shared/agent-modules.json").read_text(encoding="utf-8"))
    return dict(data["modules"])


def module_for(method: str) -> str | None:
    handler = handler_module_for(method)
    short = handler.rsplit(".", 1)[-1] if handler else None
    for module_id, spec in catalog().items():
        if method in (spec.get("methods") or []):
            return module_id
    for module_id, spec in catalog().items():
        if short and short in (spec.get("handlers") or []):
            return module_id
        if spec.get("native") and method.startswith(f"{module_id}_"):
            return module_id
    return None


def label_for(module_id: str | None) -> str:
    spec = catalog().get(module_id or "")
    return str(spec["label"]) if spec else "Antares"


def resolve_mentions(text: str) -> JsonObject:
    aliases: dict[str, set[str]] = {}
    for module_id, spec in catalog().items():
        for alias in [module_id, spec["label"], *(spec.get("aliases") or [])]:
            aliases.setdefault(_normal(str(alias)), set()).add(module_id)
    resolved: list[str] = []
    unknown: list[str] = []
    ambiguous: list[JsonObject] = []
    for match in _MENTION_RE.finditer(text):
        token = match.group(1)
        found = aliases.get(_normal(token), set())
        if len(found) == 1:
            module_id = next(iter(found))
            if module_id not in resolved:
                resolved.append(module_id)
        elif found:
            ambiguous.append({"mention": token, "modules": sorted(found)})
        elif token not in unknown:
            unknown.append(token)
    return {"modules": resolved, "unknown": unknown, "ambiguous": ambiguous}


def mention_context(module_ids: list[str], tool_names: list[str]) -> str:
    lines = []
    for module_id in module_ids:
        spec = catalog()[module_id]
        if spec.get("unavailable"):
            lines.append(f"- {spec['label']}: no disponible para el agente. {spec['unavailable']}")
            continue
        tools = [name for name in tool_names if module_for(name) == module_id]
        lines.append(f"- {spec['label']}: herramientas {', '.join(tools) if tools else '(ninguna disponible)'}")
    return "El usuario mencionó estos módulos de Antares:\n" + "\n".join(lines)
