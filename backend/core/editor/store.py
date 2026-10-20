"""Almacén de proyectos del editor (L1, plan §4.3).

Persistencia en ``user_data_path('editor')`` con subcarpetas
``projects/``, ``assets/``, ``jobs/``, ``recovery/`` y ``trash/``.
Cada guardado es atómico (temporal en el mismo volumen + ``os.replace``),
con lock por proyecto y CAS de revisión. ``requestId`` permite
deduplicar una respuesta perdida sin incrementar la revisión dos veces.
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import shutil
import threading
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from backend.core.editor.models import EditorContractError, normalize_document, validate_document
from backend.utils.lazy import LazySingleton
from backend.utils.paths import user_data_path

PROJECTS_SUBDIR = "projects"
TRASH_SUBDIR = "trash"
RECOVERY_SUBDIR = "recovery"

_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_MAX_REQUEST_MEMORY = 512


def _utc_now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def new_project_document(name: str, project_id: str | None = None) -> dict[str, Any]:  # allowlist: dict[str, Any]
    """Documento nuevo válido según el contrato compartido."""
    now = _utc_now_iso()
    doc: dict[str, Any] = {  # allowlist: dict[str, Any]
        "id": project_id or uuid.uuid4().hex,
        "schemaVersion": 1,
        "name": (name or "Proyecto sin título")[:120],
        "revision": 1,
        "createdAt": now,
        "updatedAt": now,
        "canvas": {
            "width": 1280,
            "height": 720,
            "fps": {"num": 25, "den": 1},
            "background": {"type": "solid", "color": "#000000"},
            "workingColorSpace": "bt709-sdr",
        },
        "assets": [],
        "tracks": [
            {"id": "track-v", "kind": "video", "order": 0, "visible": True, "muted": False, "locked": False},
            {"id": "track-a", "kind": "audio", "order": 1, "visible": True, "muted": False, "locked": False},
        ],
        "clips": [],
        "exportSettings": {
            "container": "mp4",
            "videoCodec": "h264",
            "audioCodec": "aac",
            "width": 1280,
            "height": 720,
            "fps": {"num": 25, "den": 1},
            "qualityPreset": "balanced",
            "audioSampleRate": 48000,
            "audioChannels": 2,
        },
    }
    return validate_document(doc)


class EditorStore:
    """CRUD de proyectos con CAS, dedup de request y papelera."""

    def __init__(self, root: str | Path | None = None) -> None:
        base = Path(root) if root is not None else user_data_path("editor")
        self.root = base
        self.projects_dir = base / PROJECTS_SUBDIR
        self.trash_dir = base / TRASH_SUBDIR
        self.recovery_dir = base / RECOVERY_SUBDIR
        for directory in (self.projects_dir, self.trash_dir, self.recovery_dir):
            directory.mkdir(parents=True, exist_ok=True)
        self._locks: dict[str, threading.RLock] = {}
        self._locks_guard = threading.Lock()
        self._request_results: dict[str, dict[str, Any]] = {}  # allowlist: dict[str, Any]
        self._request_order: list[str] = []


    def _project_lock(self, project_id: str) -> threading.RLock:
        with self._locks_guard:
            lock = self._locks.get(project_id)
            if lock is None:
                lock = threading.RLock()
                self._locks[project_id] = lock
            return lock

    def _check_id(self, project_id: str) -> str:
        if not _SAFE_ID.match(project_id or ""):
            raise EditorContractError("id de proyecto inválido")
        return project_id

    def _path_for(self, project_id: str) -> Path:
        return self.projects_dir / f"{self._check_id(project_id)}.json"

    def _write_atomic(self, path: Path, payload: bytes) -> None:
        tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:8]}.tmp")
        try:
            with tmp.open("wb") as fh:
                fh.write(payload)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, path)
        finally:
            with contextlib.suppress(OSError):
                tmp.unlink(missing_ok=True)

    def _remember_request(self, request_id: str, result: dict[str, Any]) -> None:  # allowlist: dict[str, Any]
        self._request_results[request_id] = result
        self._request_order.append(request_id)
        while len(self._request_order) > _MAX_REQUEST_MEMORY:
            stale = self._request_order.pop(0)
            self._request_results.pop(stale, None)

    def _request_hit(self, request_id: str) -> dict[str, Any] | None:  # allowlist: dict[str, Any]
        return self._request_results.get(request_id)

    @contextlib.contextmanager
    def _locked(self, project_id: str) -> Iterator[None]:
        with self._project_lock(project_id):
            yield


    def list_projects(self) -> list[dict[str, Any]]:  # allowlist: dict[str, Any]
        out: list[dict[str, Any]] = []  # allowlist: dict[str, Any]
        for path in self.projects_dir.glob("*.json"):
            try:
                doc = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            out.append(
                {
                    "id": str(doc.get("id", path.stem)),
                    "name": str(doc.get("name", path.stem)),
                    "updatedAt": str(doc.get("updatedAt", "")),
                    "revision": int(doc.get("revision", 0)),
                }
            )
        out.sort(key=lambda item: item["updatedAt"], reverse=True)
        return out

    def get(self, project_id: str) -> dict[str, Any] | None:  # allowlist: dict[str, Any]
        path = self._path_for(project_id)
        with self._locked(project_id):
            if not path.is_file():
                return None
            try:
                doc = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise EditorContractError(f"proyecto ilegible: {exc}") from exc
            validate_document(doc)
            return cast_doc(doc)


    def create(self, name: str, *, request_id: str | None = None) -> dict[str, Any]:  # allowlist: dict[str, Any]
        if request_id:
            hit = self._request_hit(request_id)
            if hit is not None:
                return hit
        doc = new_project_document(name)
        with self._locked(doc["id"]):
            self._write_atomic(self._path_for(doc["id"]), json.dumps(doc, ensure_ascii=False).encode("utf-8"))
        result = {"project": doc}
        if request_id:
            self._remember_request(request_id, result)
        return result

    def save(
        self,
        document: dict[str, Any],  # allowlist: dict[str, Any]
        *,
        expected_revision: int,
        request_id: str | None = None,
    ) -> dict[str, Any]:  # allowlist: dict[str, Any]
        if request_id:
            hit = self._request_hit(request_id)
            if hit is not None:
                return hit
        project_id = str(document.get("id", ""))
        with self._locked(project_id):
            current = self._read_unlocked(project_id)
            if current is None:
                raise EditorContractError("el proyecto no existe")
            if int(current["revision"]) != int(expected_revision):
                raise EditorContractError(
                    f"revision obsoleta: se esperaba {expected_revision} y el documento está en {current['revision']}"
                )
            saved = normalize_document(document, expected_revision=expected_revision)
            # Copia recuperable antes del reemplazo: un fallo entre
            # temporal y replace nunca pierde la última versión buena.
            recovery_copy = self.recovery_dir / f"{self._check_id(project_id)}.json"
            with contextlib.suppress(OSError):
                shutil.copy2(self._path_for(project_id), recovery_copy)
            self._write_atomic(self._path_for(project_id), json.dumps(saved, ensure_ascii=False).encode("utf-8"))
        result = {"project": saved}
        if request_id:
            self._remember_request(request_id, result)
        return result

    def _read_unlocked(self, project_id: str) -> dict[str, Any] | None:  # allowlist: dict[str, Any]
        path = self._path_for(project_id)
        if not path.is_file():
            return None
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise EditorContractError(f"proyecto ilegible: {exc}") from exc
        validate_document(doc)
        return cast_doc(doc)

    def duplicate(self, project_id: str, name: str | None = None, *, request_id: str | None = None) -> dict[str, Any]:  # allowlist: dict[str, Any]
        if request_id:
            hit = self._request_hit(request_id)
            if hit is not None:
                return hit
        source = self.get(project_id)
        if source is None:
            raise EditorContractError("el proyecto no existe")
        # Snapshot independiente: mismo contenido, nueva identidad.
        copy = json.loads(json.dumps(source))
        copy["id"] = uuid.uuid4().hex
        copy["name"] = (name or f"{source['name']} (copia)")[:120]
        now = _utc_now_iso()
        copy["createdAt"] = now
        copy["updatedAt"] = now
        copy = validate_document(copy)
        with self._locked(copy["id"]):
            self._write_atomic(self._path_for(copy["id"]), json.dumps(copy, ensure_ascii=False).encode("utf-8"))
        result = {"project": copy}
        if request_id:
            self._remember_request(request_id, result)
        return result

    def delete(self, project_id: str) -> dict[str, Any]:  # allowlist: dict[str, Any]
        """Mueve el proyecto a la papelera local (recuperable)."""
        self._check_id(project_id)
        path = self._path_for(project_id)
        with self._locked(project_id):
            if not path.is_file():
                raise EditorContractError("el proyecto no existe")
            target = self.trash_dir / f"{project_id}.json"
            os.replace(path, target)
        return {"deleted_id": project_id, "trash": True}

    def list_trash(self) -> list[dict[str, str]]:
        out: list[dict[str, str]] = []
        for path in self.trash_dir.glob("*.json"):
            try:
                doc = json.loads(path.read_text(encoding="utf-8"))
                out.append({"id": str(doc.get("id", path.stem)), "name": str(doc.get("name", path.stem))})
            except (OSError, json.JSONDecodeError):
                continue
        return out

    def restore(self, project_id: str) -> dict[str, Any]:  # allowlist: dict[str, Any]
        self._check_id(project_id)
        source = self.trash_dir / f"{project_id}.json"
        if not source.is_file():
            raise EditorContractError("el proyecto no está en la papelera")
        with self._locked(project_id):
            os.replace(source, self._path_for(project_id))
        return {"restored_id": project_id}


def cast_doc(doc: dict[str, Any]) -> dict[str, Any]:  # allowlist: dict[str, Any]
    """Copia defensiva: el renderer nunca muta lo que devuelve el store."""
    return json.loads(json.dumps(doc))  # type: ignore[no-any-return]


_store_singleton = LazySingleton(EditorStore)


def get_editor_store(root: str | Path | None = None) -> EditorStore:
    return _store_singleton.get(root)
