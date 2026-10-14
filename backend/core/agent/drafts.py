"""Borradores del agente: carpeta interna por conversación y guardado aprobado.

Las herramientas que escriben archivos reciben un nombre de archivo o carpeta y
el agente lo resuelve dentro de ``<datos>/ai-agent/drafts/<conversación>``: ahí
genera sin aprobación, sin tocar originales ni carpetas del usuario. Copiar un
borrador a una carpeta del usuario es la herramienta ``drafts_save``, que
siempre pasa por aprobación con el destino exacto y nunca sobrescribe salvo que
la aprobación lo indique.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

from backend.core.integrations.types import JsonObject

OUTPUT_DIR_KEYS = frozenset({"output_dir", "outputDir", "output_folder", "destino"})
_MAX_LISTED = 200

TOOL_SPECS: list[JsonObject] = [
    {
        "name": "drafts_list",
        "gated": False,
        "module": "drafts",
        "description": "Borradores · drafts_list (solo lectura): archivos generados en esta conversación",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "drafts_save",
        "gated": True,
        "module": "drafts",
        "description": (
            "Borradores · drafts_save (efecto: requiere aprobación del usuario): copia un borrador de esta "
            "conversación a una carpeta del usuario"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Nombre del borrador (ver drafts_list)"},
                "destination_folder": {"type": "string", "description": "Carpeta absoluta de destino"},
                "filename": {"type": "string", "description": "Nombre final; por defecto el del borrador"},
                "overwrite": {"type": "boolean", "description": "Reemplazar un archivo existente"},
            },
            "required": ["name", "destination_folder"],
        },
    },
]
READ_TOOLS = frozenset({"drafts_list"})
EFFECT_TOOLS = frozenset({"drafts_save"})


def safe_name(value: object) -> str:
    """Nombre de archivo simple, sin rutas ni nombres reservados de Windows."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Indica un nombre de archivo")
    name = value.strip()
    if name in {".", ".."} or Path(name).name != name or any(ch in name for ch in '<>:"/\\|?*\x00'):
        raise ValueError(f"Nombre de archivo no válido: {value}")
    if name.split(".")[0].upper() in {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)),
                                      *(f"LPT{i}" for i in range(1, 10))}:
        raise ValueError(f"Nombre reservado de Windows: {value}")
    return name


def inside(root: Path, value: str) -> Path | None:
    """Ruta dentro de ``root`` sin enlaces simbólicos, o ``None``."""
    path = Path(os.path.normpath(value))
    if not path.is_absolute() or ".." in Path(value).parts:
        return None
    real_root = Path(os.path.realpath(root))
    real = Path(os.path.realpath(path))
    if os.path.normcase(str(real)) != os.path.normcase(str(path)):
        return None
    if real != real_root and real_root not in real.parents:
        return None
    return real


def bind_outputs(args: JsonObject, keys: frozenset[str], root: Path) -> JsonObject:
    """Resuelve los nombres de salida dentro de la carpeta de borradores."""
    bound = dict(args)
    for key in keys:
        value = bound.get(key)
        if not value or not isinstance(value, str):
            continue
        if inside(root, value) is not None:
            continue  # ya apunta a un borrador de esta conversación
        if os.path.isabs(value) or value.startswith(("\\\\", "//")):
            raise ValueError(
                "El agente escribe en sus borradores: indica solo un nombre de archivo y guarda el resultado "
                "con drafts_save"
            )
        target = root / safe_name(value)
        root.mkdir(parents=True, exist_ok=True)
        if key in OUTPUT_DIR_KEYS:
            target.mkdir(exist_ok=True)
        bound[key] = str(target)
    return bound


def list_drafts(root: Path) -> JsonObject:
    if not root.is_dir():
        return {"drafts": []}
    items = []
    for path in sorted(root.rglob("*"))[:_MAX_LISTED]:
        if path.is_file() and not path.is_symlink():
            stat = path.stat()
            items.append({"name": path.relative_to(root).as_posix(), "size": stat.st_size,
                          "modified_ns": stat.st_mtime_ns})
    return {"drafts": items}


def save_draft(root: Path, params: JsonObject) -> JsonObject:
    relative = params.get("name")
    if not isinstance(relative, str) or not relative:
        raise ValueError("Indica el borrador que quieres guardar")
    source = inside(root, str(root / relative))
    if source is None or not source.is_file():
        raise ValueError(f"No existe el borrador {relative}")
    folder_value = params.get("destination_folder")
    if not isinstance(folder_value, str) or not os.path.isabs(folder_value) or folder_value.startswith(("\\\\", "//")):
        raise ValueError("La carpeta de destino debe ser una ruta local absoluta")
    if ".." in Path(folder_value).parts:
        raise ValueError("La carpeta de destino no puede contener '..'")
    folder = Path(os.path.normpath(folder_value))
    if not folder.is_dir():
        raise ValueError("La carpeta de destino no existe")
    if os.path.normcase(os.path.realpath(folder)) != os.path.normcase(str(folder)) or folder.is_symlink():
        raise ValueError("La carpeta de destino no puede ser un enlace simbólico ni un punto de reparse")
    target = folder / safe_name(params.get("filename") or source.name)
    overwrite = params.get("overwrite") is True
    existed = target.exists()
    if existed and (not overwrite or not target.is_file() or target.is_symlink()):
        raise ValueError(f"{target.name} ya existe en el destino; pide reemplazarlo de forma explícita")
    descriptor, temp = tempfile.mkstemp(prefix=".antares-", suffix=".tmp", dir=folder)
    os.close(descriptor)
    try:
        shutil.copyfile(source, temp)
        os.replace(temp, target)
    except BaseException:
        Path(temp).unlink(missing_ok=True)
        raise
    return {"saved_path": str(target), "replaced": existed, "size": target.stat().st_size}
