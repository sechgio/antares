"""Persistencia de Designs en disco.

Fuente de verdad: ``%LOCALAPPDATA%/Antares/design/documents/<id>.json`` (mismo
patrón que Canvas). Escritura atómica y límite de tamaño para que un documento
enorme o corrupto no pueda tumbar el arranque.
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from pathlib import Path

from backend.core.design.models import (
    DOCUMENT_VERSION,
    create_empty_document,
    normalize_document,
    utc_now_iso,
)
from backend.core.design.types import JsonObject
from backend.utils.atomic_write import atomic_write_json
from backend.utils.paths import user_data_path
from backend.utils.validators import sanitizar_nombre

logger = logging.getLogger(__name__)

MAX_DESIGN_DOCUMENT_BYTES = 4 * 1024 * 1024


class DesignStore:
    def __init__(self, root: Path | None = None) -> None:
        self._root = root or user_data_path("design/documents")
        self._lock = threading.RLock()

    @property
    def root(self) -> Path:
        return self._root

    def _path_for(self, design_id: str) -> Path:
        safe = sanitizar_nombre(str(design_id).strip()) or "unknown"
        # El id nunca cruza directorios: `sanitizar_nombre` quita separadores y
        # el `Path.name` final descarta cualquier resto de ruta.
        return self._root / f"{Path(safe).name or 'unknown'}.json"

    def _ensure_root(self) -> None:
        self._root.mkdir(parents=True, exist_ok=True)

    def _read_raw(self, path: Path) -> JsonObject | None:
        try:
            data = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return None
        if len(data.encode("utf-8")) > MAX_DESIGN_DOCUMENT_BYTES:
            logger.warning("[designStore] document too large: %s", path.name)
            return None
        try:
            parsed = json.loads(data)
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None

    def list_documents(self) -> list[JsonObject]:
        with self._lock:
            self._ensure_root()
            out: list[JsonObject] = []
            for path in sorted(self._root.glob("*.json")):
                raw = self._read_raw(path)
                if raw is None:
                    continue
                slides_raw = raw.get("slides")
                slides = slides_raw if isinstance(slides_raw, list) else []
                out.append(
                    {
                        "id": str(raw.get("id") or path.stem),
                        "name": str(raw.get("name") or "Diseño sin título"),
                        "updatedAt": str(raw.get("updatedAt") or ""),
                        "slideCount": len(slides),
                        "page": raw.get("page") if isinstance(raw.get("page"), dict) else {},
                    }
                )
            out.sort(key=lambda item: str(item.get("updatedAt") or ""), reverse=True)
            return out

    def get_document(self, design_id: str) -> JsonObject | None:
        with self._lock:
            raw = self._read_raw(self._path_for(design_id))
            return normalize_document(raw) if raw is not None else None

    def save_document(self, document: JsonObject) -> JsonObject:
        normalized = normalize_document(document)
        payload = dict(normalized)
        payload["version"] = DOCUMENT_VERSION
        payload["updatedAt"] = utc_now_iso()
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(encoded) > MAX_DESIGN_DOCUMENT_BYTES:
            raise ValueError("El diseño supera el tamaño máximo permitido")
        with self._lock:
            self._ensure_root()
            atomic_write_json(self._path_for(str(payload["id"])), payload)
        return payload

    def create_empty(self, name: str | None = None) -> JsonObject:
        document = create_empty_document()
        if isinstance(name, str) and name.strip():
            document["name"] = name.strip()
        return self.save_document(document)

    def delete_document(self, design_id: str) -> bool:
        with self._lock:
            path = self._path_for(design_id)
            if not path.is_file():
                return False
            path.unlink(missing_ok=True)
            return True

    def new_id(self) -> str:
        return str(uuid.uuid4())


_store_lock = threading.Lock()
_store: DesignStore | None = None


def get_design_store() -> DesignStore:
    global _store
    with _store_lock:
        if _store is None:
            _store = DesignStore()
        return _store
