"""File-backed Canvas document store under user data (survives app updates)."""

from __future__ import annotations

import contextlib
import json
import logging
import shutil
import threading
from pathlib import Path
from typing import Any

from backend.core.canvas.models import (
    create_empty_document,
    duplicate_document,
    normalize_document,
    utc_now_iso,
)
from backend.utils.paths import resource_path, user_data_path

logger = logging.getLogger(__name__)

_store_instance: CanvasStore | None = None
_store_lock = threading.Lock()


def _default_docs_dir() -> Path:
    """Writable store outside the install tree — survives updates."""
    return user_data_path("canvas/documents")


def _legacy_docs_dir() -> Path:
    """Pre-user-data location (repo / bundled data/)."""
    return resource_path("data/canvas/documents")


def get_canvas_store(docs_dir: str | Path | None = None) -> CanvasStore:
    global _store_instance
    if _store_instance is None:
        with _store_lock:
            if _store_instance is None:
                _store_instance = CanvasStore(docs_dir)
    return _store_instance


def migrate_legacy_canvas_documents(*, source: Path, dest: Path) -> int:
    """Copy JSON docs from *source* into *dest* without overwriting. Returns count copied."""
    if not source.is_dir():
        return 0
    try:
        if source.resolve() == dest.resolve():
            return 0
    except OSError:
        if source == dest:
            return 0

    dest.mkdir(parents=True, exist_ok=True)
    copied = 0
    for path in source.glob("*.json"):
        target = dest / path.name
        if target.exists():
            continue
        try:
            shutil.copy2(path, target)
            copied += 1
        except OSError:
            continue
    return copied


class CanvasStore:
    def __init__(
        self,
        docs_dir: str | Path | None = None,
        *,
        migrate_legacy: bool | None = None,
    ) -> None:
        using_default = docs_dir is None
        self.docs_dir = Path(docs_dir) if docs_dir is not None else _default_docs_dir()
        self.history_dir = (self.docs_dir.parent / "history") if using_default else (self.docs_dir / "history")
        self._lock = threading.RLock()
        self.docs_dir.mkdir(parents=True, exist_ok=True)
        self.history_dir.mkdir(parents=True, exist_ok=True)
        should_migrate = migrate_legacy if migrate_legacy is not None else using_default
        if should_migrate:
            migrate_legacy_canvas_documents(source=_legacy_docs_dir(), dest=self.docs_dir)

    def _path_for(self, doc_id: str) -> Path:
        safe = Path(doc_id).name
        if safe != doc_id or ".." in doc_id or "/" in doc_id or "\\" in doc_id:
            msg = f"Invalid document id: {doc_id}"
            raise ValueError(msg)
        return self.docs_dir / f"{safe}.json"

    def _history_path_for(self, doc_id: str) -> Path:
        safe = Path(doc_id).name
        if safe != doc_id or ".." in doc_id or "/" in doc_id or "\\" in doc_id:
            msg = f"Invalid document id: {doc_id}"
            raise ValueError(msg)
        return self.history_dir / f"{safe}_history.json"

    def _find_path_by_inner_id(self, doc_id: str) -> Path | None:
        """Locate a file whose body id matches when filename stem differs."""
        for path in self.docs_dir.glob("*.json"):
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError, TypeError, ValueError):
                continue
            if isinstance(raw, dict) and str(raw.get("id") or "") == doc_id:
                return path
        return None

    def list_documents(self) -> list[dict[str, str]]:
        with self._lock:
            items: list[dict[str, str]] = []
            for path in sorted(self.docs_dir.glob("*.json")):
                try:
                    raw = json.loads(path.read_text(encoding="utf-8"))
                    if not isinstance(raw, dict):
                        continue
                    # Stem is the lookup key for get()/delete(); prefer it over a
                    # mismatched body id so list → get never 404s.
                    doc_id = path.stem
                    doc_name = str(raw.get("name") or "Sin título")
                    updated_at = str(raw.get("updatedAt") or "")
                except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
                    logger.warning("Skipping unreadable canvas document %s: %s", path, exc)
                    continue
                items.append(
                    {
                        "id": doc_id,
                        "name": doc_name,
                        "updatedAt": updated_at,
                    }
                )
            return items

    def get(self, doc_id: str) -> dict[str, Any] | None:
        with self._lock:
            path = self._path_for(str(doc_id))
            if not path.exists():
                # Transitional: older list() may have exposed body id ≠ stem.
                fallback = self._find_path_by_inner_id(str(doc_id))
                if fallback is None:
                    return None
                path = fallback
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("Could not read canvas document %s: %s", path, exc)
                return None
            doc = normalize_document(raw)
            # Keep body id aligned with filename so the next save hits the same file.
            if doc["id"] != path.stem:
                doc["id"] = path.stem
            return doc

    def _normalize_history_item(self, item: dict[str, Any]) -> dict[str, Any]:
        if isinstance(item, dict) and item.get("type") == "diff":
            return item
        return normalize_document(item)

    def get_history(self, doc_id: str) -> dict[str, list[dict[str, Any]]]:
        with self._lock:
            path = self._history_path_for(str(doc_id))
            if not path.exists():
                return {"past": [], "future": []}
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(raw, dict):
                    return {"past": [], "future": []}
                past_raw = raw.get("past")
                future_raw = raw.get("future")
                past = [self._normalize_history_item(item) for item in past_raw if isinstance(item, dict)] if isinstance(past_raw, list) else []
                future = [self._normalize_history_item(item) for item in future_raw if isinstance(item, dict)] if isinstance(future_raw, list) else []
                return {"past": past, "future": future}
            except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
                logger.warning("Could not read canvas history for %s: %s", doc_id, exc)
                return {"past": [], "future": []}

    def save_history(
        self,
        doc_id: str,
        past: list[dict[str, Any]],
        future: list[dict[str, Any]],
        max_history: int = 30,
    ) -> bool:
        with self._lock:
            path = self._history_path_for(str(doc_id))
            self.history_dir.mkdir(parents=True, exist_ok=True)
            norm_past = [self._normalize_history_item(d) for d in past[-max_history:] if isinstance(d, dict)]
            norm_future = [self._normalize_history_item(d) for d in future[-max_history:] if isinstance(d, dict)]
            payload = {"past": norm_past, "future": norm_future}
            tmp = path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            tmp.replace(path)
            return True

    def save(self, document: dict[str, Any], *, touch: bool = True) -> dict[str, Any]:
        with self._lock:
            doc = normalize_document(document)
            if touch:
                doc["updatedAt"] = utc_now_iso()
            path = self._path_for(doc["id"])
            self.docs_dir.mkdir(parents=True, exist_ok=True)
            # Drop orphan files that still carry this id under a different stem.
            orphan = self._find_path_by_inner_id(doc["id"])
            if orphan is not None and orphan != path:
                with contextlib.suppress(OSError):
                    orphan.unlink()
            tmp = path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            tmp.replace(path)
            return doc

    def create(self, *, name: str = "Sin título") -> dict[str, Any]:
        return self.save(create_empty_document(name=name))

    def delete(self, doc_id: str) -> bool:
        with self._lock:
            path = self._path_for(str(doc_id))
            hist_path = self._history_path_for(str(doc_id))
            with contextlib.suppress(OSError):
                if hist_path.exists():
                    hist_path.unlink()
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
