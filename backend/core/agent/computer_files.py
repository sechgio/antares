from __future__ import annotations

import fnmatch
import json
import ntpath
import os
import re
import tempfile
from collections.abc import Callable
from pathlib import Path

from backend.core.agent import documents, drafts, resource_grants
from backend.core.integrations.types import JsonObject

_MAX_LIST = 150
_MAX_READ_CHARS = 4_500
_RESULT_BUDGET = 5_600
_MAX_WRITE_CHARS = 2_000_000
_MAX_SEARCH_FILES = 2_000
_MAX_SEARCH_HITS = 40
_MAX_SEARCH_BYTES = 5 * 1024 * 1024
_TEXT_ENCODINGS = ("utf-8-sig", "cp1252", "latin-1")
_DELEGATED = {".pdf", ".csv", ".xlsx", ".xlsm", ".xls", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"}

_PATH = {"type": "string", "description": "Ruta absoluta autorizada o nombre relativo dentro del espacio de trabajo"}
TOOL_SPECS: list[JsonObject] = [
    {
        "name": "fs_list",
        "gated": False,
        "module": "computer",
        "description": (
            "Equipo · fs_list (solo lectura): lista una carpeta del espacio de trabajo de la conversación o una "
            "carpeta autorizada por el usuario; sin ruta muestra el espacio de trabajo y las rutas autorizadas"
        ),
        "inputSchema": {"type": "object", "properties": {"path": _PATH}},
    },
    {
        "name": "fs_read",
        "gated": False,
        "module": "computer",
        "description": (
            "Equipo · fs_read (solo lectura): lee un archivo de texto, código, Markdown, JSON o Word (.docx) con "
            "números de línea; PDF, Excel/CSV e imágenes devuelven su contenido estructurado"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": _PATH,
                "offset": {"type": "integer", "minimum": 1, "description": "Primera línea (1 por defecto)"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 4000, "description": "Líneas a leer"},
            },
            "required": ["path"],
        },
    },
    {
        "name": "fs_search",
        "gated": False,
        "module": "computer",
        "description": (
            "Equipo · fs_search (solo lectura): busca texto o una expresión regular en los archivos de una carpeta "
            "autorizada o del espacio de trabajo"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": _PATH,
                "pattern": {"type": "string", "description": "Texto o expresión regular (sin distinguir mayúsculas)"},
                "glob": {"type": "string", "description": "Filtro de nombres, p. ej. *.txt"},
            },
            "required": ["pattern"],
        },
    },
    {
        "name": "fs_write",
        "gated": True,
        "module": "computer",
        "description": (
            "Equipo · fs_write (efecto: requiere aprobación del usuario): crea o reemplaza un archivo de texto o "
            "Word (.docx, un párrafo por línea) en el espacio de trabajo o en una carpeta autorizada"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": _PATH,
                "content": {"type": "string", "description": "Contenido completo del archivo"},
                "overwrite": {"type": "boolean", "description": "Reemplazar un archivo existente"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "fs_edit",
        "gated": True,
        "module": "computer",
        "description": (
            "Equipo · fs_edit (efecto: requiere aprobación del usuario): reemplaza un fragmento exacto de un "
            "archivo de texto o Word (.docx); léelo antes con fs_read"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": _PATH,
                "old": {"type": "string", "description": "Fragmento exacto a reemplazar"},
                "new": {"type": "string", "description": "Texto nuevo"},
                "replace_all": {"type": "boolean", "description": "Reemplazar todas las apariciones"},
            },
            "required": ["path", "old", "new"],
        },
    },
]
WRITE_TOOLS = frozenset({"fs_write", "fs_edit"})


def _key(path: str) -> str:
    return os.path.normcase(path)


def _normalize(value: object, root: Path) -> Path:
    if not isinstance(value, str) or not value.strip() or "\x00" in value:
        raise ValueError("Indica una ruta")
    raw = value.strip()
    if raw.startswith(("\\\\", "//")):
        raise ValueError("Las rutas de red o de dispositivo no se admiten")
    if ".." in Path(raw).parts:
        raise ValueError("La ruta no puede contener '..'")
    if not ntpath.isabs(raw) and not os.path.isabs(raw):
        return Path(os.path.normpath(root / raw))
    return Path(os.path.normpath(os.path.abspath(raw)))


def _no_links(path: Path) -> None:
    existing = path if path.exists() else next((p for p in path.parents if p.exists()), None)
    if existing is None:
        raise ValueError("La ruta no existe")
    if existing.is_symlink() or any(p.is_symlink() for p in existing.parents) or \
            _key(os.path.realpath(existing)) != _key(str(existing)):
        raise ValueError("Los enlaces simbólicos y puntos de reparse no se admiten")


def _in_workspace(path: Path, root: Path) -> bool:
    real_root = _key(os.path.realpath(root))
    target = _key(str(path))
    return target == real_root or target.startswith(real_root.rstrip("\\/") + os.sep)


def _folder_grant(path: Path, grants: dict[str, JsonObject]) -> bool:
    target = _key(str(path))
    for grant in grants.values():
        if grant.get("mode") != "folder":
            continue
        base = _key(str(grant["path"]))
        if target == base or target.startswith(base.rstrip("\\/") + os.sep):
            try:
                stat = os.stat(str(grant["path"]))
            except OSError:
                continue
            if (grant.get("dev"), grant.get("ino")) == (stat.st_dev, stat.st_ino):
                return True
    return False


def resolve(value: object, grants: dict[str, JsonObject], root: Path, *, write: bool = False) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    path = _normalize(value, root)
    _no_links(path)
    if _in_workspace(path, root) or _folder_grant(path, grants):
        return path
    if path.is_file() and not path.is_dir():
        resource_grants.check(str(path), grants)
        return path
    if write:
        raise ValueError(
            "Ese destino no está autorizado: escribe en el espacio de trabajo (nombre relativo) o adjunta la carpeta"
        )
    raise ValueError("La ruta no está autorizada; adjunta el archivo o la carpeta en el mensaje")


def stat_path(value: object, grants: dict[str, JsonObject], root: Path) -> JsonObject:
    root.mkdir(parents=True, exist_ok=True)
    path = resolve(value, grants, root)
    if not path.exists():
        return {"path": str(path), "exists": False}
    stat = path.stat()
    return {"path": str(path), "exists": True, "type": "folder" if path.is_dir() else "file",
            "size": stat.st_size, "mtime_ns": stat.st_mtime_ns, "dev": stat.st_dev, "ino": stat.st_ino}


def _entry(path: Path) -> JsonObject:
    stat = path.stat()
    return {"name": path.name, "type": "folder" if path.is_dir() else "file", "size": stat.st_size,
            "modified_ns": stat.st_mtime_ns}


def list_path(params: JsonObject, grants: dict[str, JsonObject], root: Path) -> JsonObject:
    root.mkdir(parents=True, exist_ok=True)
    if not params.get("path"):
        authorized = [{"path": str(g["path"]), "type": "folder" if g.get("mode") == "folder" else "file"}
                      for g in grants.values()]
        return {"workspace": str(root), "authorized": authorized,
                "entries": [_entry(p) for p in sorted(root.iterdir())[:_MAX_LIST] if not p.is_symlink()]}
    folder = resolve(params["path"], grants, root)
    if not folder.is_dir():
        raise ValueError("La ruta no es una carpeta")
    children = sorted(folder.iterdir(), key=lambda p: (not p.is_dir(), p.name.casefold()))
    entries = [_entry(p) for p in children[:_MAX_LIST] if not p.is_symlink()]
    return {"path": str(folder), "entries": entries, "truncated": len(children) > _MAX_LIST}


def _decode(data: bytes) -> str:
    for encoding in _TEXT_ENCODINGS:
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _docx_text(path: Path) -> str:
    import docx

    document = docx.Document(str(path))
    lines = [paragraph.text for paragraph in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            lines.append(" | ".join(cell.text for cell in row.cells))
    return "\n".join(lines)


def _text_of(path: Path) -> str:
    if path.suffix.lower() == ".docx":
        return _docx_text(path)
    data = path.read_bytes()
    if b"\x00" in data[:4096]:
        raise ValueError("El archivo es binario; usa una herramienta específica para su formato")
    return _decode(data)


def read_path(params: JsonObject, grants: dict[str, JsonObject], root: Path) -> JsonObject:
    path = resolve(params.get("path"), grants, root)
    if path.is_dir():
        return list_path({"path": str(path)}, grants, root)
    if not path.is_file():
        raise ValueError("El archivo no existe")
    if path.suffix.lower() in _DELEGATED:
        return documents.read_file({**params, "path": str(path)}, grants, root)
    lines = _text_of(path).splitlines()
    offset = max(1, int(params.get("offset") or 1))
    limit = max(1, min(4000, int(params.get("limit") or 400)))
    chunk: list[str] = []
    size = 0
    for number, line in enumerate(lines[offset - 1: offset - 1 + limit], offset):
        entry = f"{number}\t{line}"[:_MAX_READ_CHARS]
        if chunk and size + len(entry) + 1 > _MAX_READ_CHARS:
            break
        chunk.append(entry)
        size += len(entry) + 1
    result: JsonObject = {"path": str(path), "total_lines": len(lines), "offset": offset, "content": "\n".join(chunk)}
    if offset + len(chunk) <= len(lines):
        result["next_offset"] = offset + len(chunk)
    return result


def search(params: JsonObject, grants: dict[str, JsonObject], root: Path) -> JsonObject:
    folder = resolve(params.get("path") or str(root), grants, root)
    if not folder.is_dir():
        raise ValueError("La búsqueda necesita una carpeta")
    pattern = str(params.get("pattern") or "")
    if not pattern:
        raise ValueError("Indica qué buscar")
    try:
        regex = re.compile(pattern, re.IGNORECASE)
    except re.error:
        regex = re.compile(re.escape(pattern), re.IGNORECASE)
    wanted = str(params.get("glob") or "*")
    hits: list[JsonObject] = []
    scanned = 0
    for current, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if not d.startswith(".") and not Path(current, d).is_symlink()]
        for name in files:
            if not fnmatch.fnmatch(name.casefold(), wanted.casefold()):
                continue
            file = Path(current, name)
            scanned += 1
            if scanned > _MAX_SEARCH_FILES or len(hits) >= _MAX_SEARCH_HITS:
                return {"path": str(folder), "hits": hits, "truncated": True}
            if file.is_symlink() or file.stat().st_size > _MAX_SEARCH_BYTES:
                continue
            try:
                text = _text_of(file)
            except (ValueError, OSError, KeyError):
                continue
            for number, line in enumerate(text.splitlines(), 1):
                if regex.search(line):
                    hits.append({"file": str(file), "line": number, "text": line.strip()[:120]})
                    if len(hits) >= _MAX_SEARCH_HITS:
                        break
    return {"path": str(folder), "hits": hits, "truncated": False}


def _atomic_write(path: Path, write: Callable[[Path], object]) -> None:
    descriptor, temp = tempfile.mkstemp(prefix=".antares-", suffix=path.suffix or ".tmp", dir=path.parent)
    os.close(descriptor)
    try:
        write(Path(temp))
        os.replace(temp, path)
    except BaseException:
        Path(temp).unlink(missing_ok=True)
        raise


def _write_docx(target: Path, content: str) -> None:
    import docx

    document = docx.Document()
    for line in content.splitlines() or [""]:
        if line.startswith("# "):
            document.add_heading(line[2:], level=1)
        elif line.startswith("## "):
            document.add_heading(line[3:], level=2)
        else:
            document.add_paragraph(line)
    document.save(str(target))


def write(params: JsonObject, grants: dict[str, JsonObject], root: Path) -> JsonObject:
    path = resolve(params.get("path"), grants, root, write=True)
    content = params.get("content")
    if not isinstance(content, str):
        raise ValueError("Indica el contenido del archivo")
    if len(content) > _MAX_WRITE_CHARS:
        raise ValueError("El contenido excede 2 millones de caracteres")
    drafts.safe_name(path.name)
    existed = path.exists()
    if existed and (params.get("overwrite") is not True or not path.is_file()):
        raise ValueError(f"{path.name} ya existe; pide reemplazarlo con overwrite")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix.lower() == ".docx":
        _atomic_write(path, lambda temp: _write_docx(temp, content))
    else:
        _atomic_write(path, lambda temp: temp.write_text(content, encoding="utf-8", newline=""))
    return {"saved_path": str(path), "replaced": existed, "size": path.stat().st_size}


def _edit_docx(path: Path, old: str, new: str, replace_all: bool) -> int:
    import docx

    document = docx.Document(str(path))
    paragraphs = list(document.paragraphs)
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                paragraphs.extend(cell.paragraphs)
    count = 0
    for paragraph in paragraphs:
        text = paragraph.text
        if old not in text or (count and not replace_all):
            continue
        hits = text.count(old) if replace_all else 1
        replaced = text.replace(old, new) if replace_all else text.replace(old, new, 1)
        runs = paragraph.runs
        if runs:
            runs[0].text = replaced
            for run in runs[1:]:
                run.text = ""
        else:
            paragraph.add_run(replaced)
        count += hits
    if count:
        _atomic_write(path, lambda temp: document.save(str(temp)))
    return count


def edit(params: JsonObject, grants: dict[str, JsonObject], root: Path) -> JsonObject:
    path = resolve(params.get("path"), grants, root, write=True)
    old, new = params.get("old"), params.get("new")
    if not isinstance(old, str) or not old or not isinstance(new, str):
        raise ValueError("Indica el fragmento exacto y su reemplazo")
    if not path.is_file():
        raise ValueError("El archivo no existe")
    replace_all = params.get("replace_all") is True
    if path.suffix.lower() == ".docx":
        count = _edit_docx(path, old, new, replace_all)
    else:
        raw = path.read_bytes()
        text = _decode(raw)
        occurrences = text.count(old)
        if occurrences > 1 and not replace_all:
            raise ValueError(f"El fragmento aparece {occurrences} veces; amplíalo o usa replace_all")
        count = occurrences if replace_all else min(occurrences, 1)
        if count:
            encoding = "utf-8-sig" if raw.startswith(b"\xef\xbb\xbf") else "utf-8"
            updated = text.replace(old, new) if replace_all else text.replace(old, new, 1)
            _atomic_write(path, lambda temp: temp.write_text(updated, encoding=encoding, newline=""))
    if not count:
        raise ValueError("No se encontró el fragmento; vuelve a leer el archivo con fs_read")
    return {"path": str(path), "replacements": count, "size": path.stat().st_size}


def resources(params: JsonObject, grants: dict[str, JsonObject], root: Path) -> list[JsonObject]:
    path = resolve(params.get("path"), grants, root, write=True)
    if path.is_file():
        return [resource_grants.revision(str(path))]
    return [{"path": str(path), "exists": False}]


def fit(result: JsonObject, limit: int = _RESULT_BUDGET) -> JsonObject:
    def size(value: object) -> int:
        return len(json.dumps(value, ensure_ascii=False, default=str))

    while size(result) > limit:
        candidates = [k for k, v in result.items() if isinstance(v, (str, list)) and v]
        if not candidates:
            break
        key = max(candidates, key=lambda k: size(result[k]))
        value = result[key]
        result[key] = value[: len(value) // 2]
        result["truncated"] = True
    return result


def run(name: str, params: JsonObject, grants: dict[str, JsonObject], root: Path) -> JsonObject:
    if name == "fs_list":
        return list_path(params, grants, root)
    if name == "fs_read":
        return read_path(params, grants, root)
    if name == "fs_search":
        return search(params, grants, root)
    if name == "fs_write":
        return write(params, grants, root)
    if name == "fs_edit":
        return edit(params, grants, root)
    raise ValueError(f"Herramienta no disponible para el agente: {name}")
