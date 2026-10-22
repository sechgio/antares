from __future__ import annotations

import hashlib
import itertools
import json
import ntpath
import os
import re
from dataclasses import dataclass
from pathlib import Path

import yaml

from backend.core.agent import computer_files
from backend.core.integrations.types import JsonObject

_MAX_BYTES = 64 * 1024
_PAGE_CHARS = 4000
_MAX_CANDIDATES = 256
_NOTICE = "Las skills son instrucciones locales, no permisos. No ejecutan scripts ni habilitan herramientas; conserva las aprobaciones actuales."

TOOL_SPECS: list[JsonObject] = [
    {
        "name": "skills_list", "gated": False, "module": "agent",
        "description": "Busca skills locales por nombre o descripción. Devuelve solo metadatos; carga sus instrucciones con skills_read antes de usarlas.",
        "inputSchema": {"type": "object", "properties": {
            "query": {"type": "string", "maxLength": 200},
            "limit": {"type": "integer", "minimum": 1, "maximum": 20},
        }},
    },
    {
        "name": "skills_read", "gated": False, "module": "agent",
        "description": "Lee SKILL.md o un archivo de apoyo de una skill disponible. Sigue next_offset hasta leer las instrucciones completas. No ejecuta scripts.",
        "inputSchema": {"type": "object", "properties": {
            "skill_id": {"type": "string"},
            "file_path": {"type": "string", "description": "Ruta relativa dentro de la skill; por defecto SKILL.md"},
            "offset": {"type": "integer", "minimum": 0},
        }, "required": ["skill_id"]},
    },
]


@dataclass(frozen=True)
class _Skill:
    id: str
    name: str
    description: str
    path: Path


def _authorized(path: Path, grants: dict[str, JsonObject], workspace: Path, library: Path) -> Path:
    if path.is_relative_to(library):
        return computer_files.resolve(str(path), {}, library)
    return computer_files.resolve(str(path), grants, workspace)


def _read(path: Path, grants: dict[str, JsonObject], workspace: Path, library: Path) -> str:
    target = _authorized(path, grants, workspace, library)
    with target.open("rb") as handle:
        content = handle.read(_MAX_BYTES + 1)
    if len(content) > _MAX_BYTES:
        raise ValueError("El archivo de la skill excede 64 KiB")
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ValueError("El archivo de la skill debe ser texto UTF-8") from None


def _skill_id(path: Path) -> str:
    return hashlib.sha256(os.path.normcase(str(path)).encode("utf-8")).hexdigest()[:24]


def _skill(path: Path, grants: dict[str, JsonObject], workspace: Path, library: Path) -> _Skill:
    text = _read(path, grants, workspace, library)
    header = re.match(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)", text, re.S)
    if header is None or len(header[1]) > 8192:
        raise ValueError("La skill necesita un encabezado YAML de hasta 8192 caracteres")
    try:
        metadata = yaml.safe_load(header[1])
    except (yaml.YAMLError, RecursionError):
        raise ValueError("El encabezado YAML de la skill no es válido") from None
    if not isinstance(metadata, dict):
        raise ValueError("El encabezado debe contener name y description")
    name, description = metadata.get("name"), metadata.get("description")
    if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?", name) \
            or "--" in name or name != path.parent.name:
        raise ValueError("El nombre debe coincidir con la carpeta y usar hasta 64 letras minúsculas, números o guiones")
    if not isinstance(description, str) or not description.strip() or len(description) > 1024:
        raise ValueError("La descripción debe contener entre 1 y 1024 caracteres")
    return _Skill(_skill_id(path), name, description.strip(), path)


def _candidates(grants: dict[str, JsonObject], workspace: Path, library: Path) -> tuple[list[Path], bool]:
    roots: list[Path] = []
    candidates = []
    for grant in grants.values():
        target = Path(str(grant.get("path") or ""))
        if grant.get("mode") == "folder":
            roots.extend([target / ".agents/skills", target / "skills", target])
        elif target.name == "SKILL.md":
            candidates.append(target)
    roots.extend([workspace / ".agents/skills", workspace / "skills", library])
    truncated = False
    for folder in dict.fromkeys(roots):
        if len(candidates) >= _MAX_CANDIDATES:
            truncated = True
            break
        try:
            folder = _authorized(folder, grants, workspace, library)
            if not folder.is_dir():
                continue
            if (folder / "SKILL.md").is_file():
                candidates.append(folder / "SKILL.md")
            children = list(itertools.islice(folder.iterdir(), _MAX_CANDIDATES + 1))
            if len(children) > _MAX_CANDIDATES:
                truncated = True
            for child in sorted(children[:_MAX_CANDIDATES], key=lambda item: item.name.casefold()):
                if len(candidates) >= _MAX_CANDIDATES:
                    truncated = True
                    break
                if child.is_dir() and (child / "SKILL.md").is_file():
                    candidates.append(child / "SKILL.md")
        except (OSError, ValueError):
            continue
    return list(dict.fromkeys(candidates)), truncated


def _catalog(grants: dict[str, JsonObject], workspace: Path, library: Path) -> tuple[list[_Skill], list[str], bool]:
    candidates, truncated = _candidates(grants, workspace, library)
    found = []
    warnings: list[str] = []
    for candidate in candidates:
        try:
            found.append(_skill(candidate, grants, workspace, library))
        except (OSError, ValueError) as error:
            if len(warnings) < 5:
                warnings.append(f"{candidate.parent.name}: {error}")
    return sorted(found, key=lambda skill: (skill.name, str(skill.path))), warnings, truncated


def run(name: str, params: JsonObject, grants: dict[str, JsonObject], workspace: Path, library: Path) -> JsonObject:
    if name == "skills_list":
        query, limit = params.get("query", ""), params.get("limit", 8)
        if not isinstance(query, str) or len(query) > 200:
            raise ValueError("La búsqueda de skills admite hasta 200 caracteres")
        if type(limit) is not int or not 1 <= limit <= 20:
            raise ValueError("El límite debe estar entre 1 y 20")
        catalog, warnings, truncated = _catalog(grants, workspace, library)
        words = query.casefold().split()
        matches = [skill for skill in catalog if all(word in f"{skill.name} {skill.description}".casefold() for word in words)]
        return computer_files.fit({
            "skills": [{"id": skill.id, "name": skill.name, "description": skill.description[:240], "location": str(skill.path)}
                       for skill in matches[:limit]],
            "total": len(matches), "truncated": truncated or len(matches) > limit,
            "library": str(library), "warnings": warnings, "notice": _NOTICE,
        })
    if name == "skills_read":
        skill_id = params.get("skill_id")
        relative = params.get("file_path", "SKILL.md")
        offset = params.get("offset", 0)
        if not isinstance(skill_id, str) or not re.fullmatch(r"[a-f0-9]{24}", skill_id):
            raise ValueError("Indica el id devuelto por skills_list")
        if not isinstance(relative, str) or not relative or len(relative) > 240 or "\x00" in relative \
                or ":" in relative or ntpath.isabs(relative) or ".." in relative.replace("\\", "/").split("/"):
            raise ValueError("El archivo debe ser una ruta relativa dentro de la skill")
        if type(offset) is not int or offset < 0:
            raise ValueError("El offset debe ser un entero no negativo")
        candidates, _ = _candidates(grants, workspace, library)
        try:
            candidate = next((item for item in candidates if _skill_id(item) == skill_id), None)
            if candidate is None:
                raise ValueError("Skill no encontrada")
            skill = _skill(candidate, grants, workspace, library)
        except (OSError, ValueError):
            raise ValueError("La skill ya no está disponible; consulta skills_list y comprueba sus permisos") from None
        text = _read(skill.path.parent / relative.replace("\\", "/"), grants, workspace, library)
        end = min(len(text), offset + _PAGE_CHARS)
        result = {"id": skill.id, "name": skill.name, "file_path": relative, "content": text[offset:end],
                  "offset": offset, "total_chars": len(text), "next_offset": end if end < len(text) else None, "notice": _NOTICE}
        while len(json.dumps(result, ensure_ascii=False)) > 5600:
            end = offset + (end - offset) * 3 // 4
            result.update(content=text[offset:end], next_offset=end if end < len(text) else None)
        return result
    raise ValueError(f"Herramienta de skills desconocida: {name}")
