"""File-backed Canvas document store under data/canvas/documents/."""

from __future__ import annotations

import json
import sys
import threading
from pathlib import Path
from typing import Any

from backend.core.canvas.models import create_empty_document, duplicate_document, normalize_document
from backend.utils.paths import resource_path, user_data_path

_store_instance: CanvasStore | None = None
_store_lock = threading.Lock()


def _default_docs_dir() -> Path:
    if getattr(sys, "frozen", False):
        return user_data_path("canvas/documents")
    return resource_path("data/canvas/documents")


def get_canvas_store(docs_dir: str | Path | None = None) -> CanvasStore:
    global _store_instance
    if _store_instance is None:
        with _store_lock:
            if _store_instance is None:
                _store_instance = CanvasStore(docs_dir)
    return _store_instance


class CanvasStore:
    def __init__(self, docs_dir: str | Path | None = None) -> None:
        self.docs_dir = Path(docs_dir) if docs_dir is not None else _default_docs_dir()
        self._lock = threading.RLock()
        self.docs_dir.mkdir(parents=True, exist_ok=True)

    def _path_for(self, doc_id: str) -> Path:
        safe = Path(doc_id).name
        if safe != doc_id or ".." in doc_id or "/" in doc_id or "\\" in doc_id:
            msg = f"Invalid document id: {doc_id}"
            raise ValueError(msg)
        return self.docs_dir / f"{safe}.json"

    def list_documents(self) -> list[dict[str, str]]:
        with self._lock:
            items: list[dict[str, str]] = []
            for path in sorted(self.docs_dir.glob("*.json")):
                try:
                    raw = json.loads(path.read_text(encoding="utf-8"))
                    doc = normalize_document(raw)
                except (OSError, json.JSONDecodeError, TypeError, ValueError):
                    continue
                items.append({"id": doc["id"], "name": doc["name"]})
            return items

    def get(self, doc_id: str) -> dict[str, Any] | None:
        with self._lock:
            path = self._path_for(str(doc_id))
            if not path.exists():
                return None
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                return None
            return normalize_document(raw)

    def save(self, document: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            doc = normalize_document(document)
            path = self._path_for(doc["id"])
            self.docs_dir.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(path)
            return doc

    def create(self, *, name: str = "Sin título") -> dict[str, Any]:
        return self.save(create_empty_document(name=name))

    def delete(self, doc_id: str) -> bool:
        with self._lock:
            path = self._path_for(str(doc_id))
            if not path.exists():
                return False
            path.unlink()
            return True

    def duplicate(self, doc_id: str, *, name: str | None = None) -> dict[str, Any]:
        source = self.get(doc_id)
        if source is None:
            msg = f"Document not found: {doc_id}"
            raise ValueError(msg)
        existing = {item["name"] for item in self.list_documents()}
        return self.save(duplicate_document(source, name=name, existing_names=existing))
