"""Historial content-addressed de artefactos de agente.

Cada registro de artefacto copia los bytes verificados a un almacén por
revisión, de modo que una versión anterior puede restaurarse con su hash
exacto. El índice conserva provenance (sesión y origen) y admite tombstones
recuperables. Las revisiones se podan por artefacto para acotar el disco.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import threading
import time
from pathlib import Path

from backend.core.agent import drafts
from backend.utils.atomic_write import atomic_write_json

MAX_REVISIONS = 20
MAX_FILE_BYTES = 100 * 1024 * 1024

_lock = threading.Lock()


def _now_ms() -> int:
    return int(time.time() * 1000)


def _index_path(base: Path) -> Path:
    return base / "artifact-versions.json"


def _content_root(base: Path) -> Path:
    return base / ".artifact-versions"


def _safe(value: str) -> str:
    return "".join(ch for ch in str(value) if ch.isalnum() or ch in "-_")[:64]


def _read_index(base: Path) -> dict:
    try:
        data = json.loads(_index_path(base).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_index(base: Path, index: dict) -> None:
    atomic_write_json(_index_path(base), index)


def _confined(drafts_dir: Path, value: str) -> Path | None:
    """Resuelve la ruta de un archivo de artefacto confinada al espacio de borradores.

    Los registros pueden llevar rutas relativas al espacio o absolutas; ambas se
    validan con realpath para rechazar traversal, symlinks y salidas del espacio.
    """
    if not value:
        return None
    candidate = value if Path(value).is_absolute() else str(drafts_dir / value)
    return drafts.inside(drafts_dir, candidate)


def record(base: Path, session_id: str, artifact: dict, drafts_dir: Path, provenance: dict | None = None) -> dict | None:
    """Registra una revisión del artefacto copiando los bytes verificados.

    Devuelve la revisión creada o None si ningún archivo tenía bytes
    copiables. Nunca rompe el registro del artefacto: una copia fallida solo
    deja la revisión sin bytes restaurables.
    """
    artifact_id = _safe(artifact.get("id") or "")
    if not artifact_id:
        return None
    files = artifact.get("files")
    if not isinstance(files, list) or not files:
        return None
    with _lock:
        index = _read_index(base)
        session_bucket = index.setdefault(session_id, {})
        entry = session_bucket.setdefault(artifact_id, {"tombstoned": False, "tombstoned_at": None, "revisions": []})
        revisions = entry["revisions"]
        head = revisions[-1]["revision"] if revisions else 0
        revision = head + 1
        target_dir = _content_root(base) / artifact_id / str(revision)
        recorded_files = []
        for position, file in enumerate(files):
            if not isinstance(file, dict) or not file.get("sha256"):
                continue
            source = _confined(drafts_dir, str(file.get("path") or ""))
            if source is None:
                continue
            try:
                if not source.is_file() or source.stat().st_size > MAX_FILE_BYTES:
                    continue
                content = source.read_bytes()
            except OSError:
                continue
            digest = hashlib.sha256(content).hexdigest()
            item = {
                "index": position,
                "path": file.get("path"),
                "name": file.get("name"),
                "sha256": digest,
                "bytes": len(content),
                "available": digest == file["sha256"],
            }
            if item["available"]:
                target_dir.mkdir(parents=True, exist_ok=True)
                (target_dir / str(position)).write_bytes(content)
            recorded_files.append(item)
        if not recorded_files:
            return None
        created = {
            "revision": revision,
            "parent_revision": head or None,
            "at": _now_ms(),
            "files": recorded_files,
            "provenance": dict(provenance or {}),
        }
        revisions.append(created)
        while len(revisions) > MAX_REVISIONS:
            dropped = revisions.pop(0)
            shutil.rmtree(_content_root(base) / artifact_id / str(dropped["revision"]), ignore_errors=True)
        _write_index(base, index)
        return {"revision": revision, "parent_revision": created["parent_revision"], "at": created["at"]}


def versions(base: Path, session_id: str, artifact_id: str) -> dict:
    with _lock:
        entry = (_read_index(base).get(session_id) or {}).get(_safe(artifact_id))
        if entry is None:
            return {"revisions": [], "tombstoned": False}
        revisions = [
            {
                "revision": item["revision"],
                "parent_revision": item.get("parent_revision"),
                "at": item.get("at"),
                "provenance": item.get("provenance") or {},
                "files": [
                    {"index": f.get("index"), "name": f.get("name"), "sha256": f.get("sha256"), "bytes": f.get("bytes"), "available": f.get("available")}
                    for f in item.get("files", [])
                ],
            }
            for item in entry.get("revisions", [])
        ]
        return {"revisions": revisions, "tombstoned": bool(entry.get("tombstoned")), "tombstoned_at": entry.get("tombstoned_at")}


def read_file(base: Path, session_id: str, artifact_id: str, digest: str, limit: int) -> tuple[bytes, str] | None:
    with _lock:
        safe_id = _safe(artifact_id)
        entry = (_read_index(base).get(session_id) or {}).get(safe_id) or {}
        for revision in reversed(entry.get("revisions", [])):
            for file in revision.get("files", []):
                if file.get("index") != 0 or not file.get("available") or file.get("sha256") != digest:
                    continue
                root = _content_root(base)
                blob = drafts.inside(root, str(root / safe_id / str(revision["revision"]) / "0"))
                if blob is None:
                    continue
                try:
                    with blob.open("rb") as stream:
                        content = stream.read(limit + 1)
                except OSError:
                    continue
                if len(content) <= limit and hashlib.sha256(content).hexdigest() == digest:
                    return content, str(file.get("name") or "")
        return None


def restore(base: Path, session_id: str, artifact_id: str, revision: int, drafts_dir: Path) -> dict:
    """Copia los bytes de una revisión de vuelta a los borradores.

    Verifica cada hash antes de escribir y exige que todos los archivos de la
    revisión estén disponibles, para no dejar el artefacto a medias.
    """
    safe_id = _safe(artifact_id)
    with _lock:
        entry = (_read_index(base).get(session_id) or {}).get(safe_id)
        if entry is None:
            raise ValueError("El artefacto no tiene historial de versiones")
        match = next((item for item in entry.get("revisions", []) if item["revision"] == revision), None)
        if match is None:
            raise ValueError("La revisión pedida no existe")
        files = match.get("files", [])
        missing = [f for f in files if not f.get("available")]
        if missing or not files:
            raise ValueError("La revisión no conserva sus bytes; no se puede restaurar")
        version_dir = _content_root(base) / safe_id / str(revision)
        staged: list[tuple[Path, bytes, str]] = []
        for file in files:
            blob = version_dir / str(file["index"])
            if not blob.is_file():
                raise ValueError("La revisión perdió bytes en disco; no se puede restaurar")
            content = blob.read_bytes()
            if hashlib.sha256(content).hexdigest() != file["sha256"]:
                raise ValueError("La revisión está corrupta; no se puede restaurar")
            target = _confined(drafts_dir, str(file.get("path") or ""))
            if target is None:
                raise ValueError("La revisión apunta fuera del espacio de artefactos; no se puede restaurar")
            staged.append((target, content, str(file.get("path") or "")))
        for target, content, _rel in staged:
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_name(target.name + ".restore-tmp")
            tmp.write_bytes(content)
            tmp.replace(target)
        return {"restored": len(staged), "paths": [rel for _t, _c, rel in staged]}


def set_tombstone(base: Path, session_id: str, artifact_id: str, tombstoned: bool) -> dict:
    with _lock:
        index = _read_index(base)
        entry = (index.setdefault(session_id, {})).setdefault(_safe(artifact_id), {"revisions": []})
        entry["tombstoned"] = bool(tombstoned)
        entry["tombstoned_at"] = _now_ms() if tombstoned else None
        _write_index(base, index)
        return {"tombstoned": entry["tombstoned"], "tombstoned_at": entry["tombstoned_at"]}
