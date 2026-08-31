"""File-backed Canvas document store under user data (survives app updates)."""

from __future__ import annotations

import contextlib
import json
import logging
import re
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

_MAX_HISTORY_ENTRY_BYTES = 8 * 1024 * 1024
_HISTORY_SPILL_SUFFIX = "_history.json"


def _history_entry_size_ok(item: dict[str, Any]) -> bool:  # type: ignore[typeddict-item]
    encoded = json.dumps(item, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return len(encoded) <= _MAX_HISTORY_ENTRY_BYTES

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


def _meta_from_dict(raw: dict[str, Any]) -> tuple[str, str, str]:  # type: ignore[typeddict-item]
    return (
        str(raw.get("name") or "Sin título"),
        str(raw.get("updatedAt") or ""),
        str(raw.get("id") or ""),
    )


def _extract_doc_meta(path: Path) -> tuple[str, str, str] | None:
    try:
        size = path.stat().st_size
        if size < 65536:
            raw = json.loads(path.read_text(encoding="utf-8"))
            return _meta_from_dict(raw) if isinstance(raw, dict) else None

        with path.open("r", encoding="utf-8", errors="ignore") as f:
            head = f.read(8192)

        name_match = re.search(r'"name"\s*:\s*"((?:[^"\\]|\\.)*)"', head)
        updated_match = re.search(r'"updatedAt"\s*:\s*"((?:[^"\\]|\\.)*)"', head)
        id_match = re.search(r'"id"\s*:\s*"((?:[^"\\]|\\.)*)"', head)

        if name_match:
            try:
                doc_name = json.loads(f'"{name_match.group(1)}"')
            except Exception:
                doc_name = name_match.group(1)
        else:
            doc_name = "Sin título"

        updated_at = updated_match.group(1) if updated_match else ""
        inner_id = id_match.group(1) if id_match else ""

        if not name_match or not id_match:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                return _meta_from_dict(raw)

        return str(doc_name), str(updated_at), str(inner_id)
    except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
        logger.warning("Skipping unreadable canvas document %s: %s", path, exc)
        return None


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
        self._index_stems: set[str] | None = None
        self._inner_id_index: dict[str, Path] = {}
        self._listing_cache: list[dict[str, str]] = []
        self._recover_pending_spills()

    def _safe_stem(self, doc_id: str) -> str:
        safe = Path(doc_id).name
        if safe != doc_id or ".." in doc_id or "/" in doc_id or "\\" in doc_id:
            raise ValueError(f"Invalid document id: {doc_id}")
        return safe

    def _path_for(self, doc_id: str) -> Path:
        return self.docs_dir / f"{self._safe_stem(doc_id)}.json"

    def _history_path_for(self, doc_id: str) -> Path:
        return self.history_dir / f"{self._safe_stem(doc_id)}_history.json"

    @staticmethod
    def _spill_is_newer(spill_path: Path, target: Path) -> bool:
        try:
            return not target.exists() or spill_path.stat().st_mtime_ns > target.stat().st_mtime_ns
        except OSError as exc:
            logger.warning("Could not compare canvas spill %s with %s: %s", spill_path, target, exc)
            return False

    def _recover_document_spill(self, spill_path: Path) -> None:
        doc_id = spill_path.stem
        try:
            target = self._path_for(doc_id)
            if not self._spill_is_newer(spill_path, target):
                spill_path.unlink(missing_ok=True)
                return
            raw = json.loads(spill_path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict):
                raise ValueError("document spill must be an object")
            document = normalize_document(raw)
            document["id"] = doc_id
            self.save(document, touch=False)
            spill_path.unlink(missing_ok=True)
            logger.info("Recovered canvas document spill: %s", spill_path)
        except (OSError, TypeError, ValueError) as exc:
            logger.warning("Could not recover canvas document spill %s: %s", spill_path, exc)

    def _recover_history_spill(self, spill_path: Path) -> None:
        doc_id = spill_path.name.removesuffix(_HISTORY_SPILL_SUFFIX)
        try:
            target = self._history_path_for(doc_id)
            if not self._spill_is_newer(spill_path, target):
                spill_path.unlink(missing_ok=True)
                return
            raw = json.loads(spill_path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict):
                raise ValueError("history spill must be an object")
            past = self._history_entries(raw.get("past"))
            future = self._history_entries(raw.get("future"))
            self.save_history(doc_id, past, future)
            spill_path.unlink(missing_ok=True)
            logger.info("Recovered canvas history spill: %s", spill_path)
        except (OSError, TypeError, ValueError) as exc:
            logger.warning("Could not recover canvas history spill %s: %s", spill_path, exc)

    @staticmethod
    def _history_entries(value: object) -> list[dict[str, Any]]:  # type: ignore[typeddict-item]
        if not isinstance(value, list):
            return []
        return [item for item in value if isinstance(item, dict)]

    def _recover_pending_spills(self) -> None:
        spill_dir = self.docs_dir.parent / "spill"
        if not spill_dir.is_dir():
            return
        for spill_path in sorted(spill_dir.glob("*.json")):
            if spill_path.name.endswith(_HISTORY_SPILL_SUFFIX):
                self._recover_history_spill(spill_path)
            else:
                self._recover_document_spill(spill_path)

    def _rebuild_index_if_stale(self) -> None:
        """Rebuild id index and listing cache if *.json set changed."""
        current_stems = {p.stem for p in self.docs_dir.glob("*.json")}
        if self._index_stems == current_stems:
            return
        self._index_stems = current_stems
        self._inner_id_index = {}
        self._listing_cache = []
        for path in sorted(self.docs_dir.glob("*.json")):
            meta = _extract_doc_meta(path)
            if meta is None:
                continue
            doc_name, updated_at, inner_id = meta
            doc_id = path.stem
            if inner_id:
                self._inner_id_index[inner_id] = path
            self._listing_cache.append({"id": doc_id, "name": doc_name, "updatedAt": updated_at})

    def _find_path_by_inner_id(self, doc_id: str) -> Path | None:
        self._rebuild_index_if_stale()
        return self._inner_id_index.get(doc_id)

    def list_documents(self) -> list[dict[str, str]]:
        with self._lock:
            self._rebuild_index_if_stale()
            return list(self._listing_cache)

    def get(self, doc_id: str) -> dict[str, Any] | None:  # type: ignore[typeddict-item]
        with self._lock:
            path = self._path_for(str(doc_id))
            if not path.exists():
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
            if doc["id"] != path.stem:
                doc["id"] = path.stem
            return doc

    def _normalize_history_item(self, item: dict[str, Any]) -> dict[str, Any]:  # type: ignore[typeddict-item]
        if isinstance(item, dict) and item.get("type") == "diff":
            return item
        return normalize_document(item)

    def get_history(self, doc_id: str) -> dict[str, list[dict[str, Any]]]:  # type: ignore[typeddict-item]
        with self._lock:
            path = self._history_path_for(str(doc_id))
            if not path.exists():
                return {"past": [], "future": []}
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(raw, dict):
                    return {"past": [], "future": []}
                past = [
                    self._normalize_history_item(item)
                    for item in self._history_entries(raw.get("past"))
                    if _history_entry_size_ok(item)
                ]
                future = [
                    self._normalize_history_item(item)
                    for item in self._history_entries(raw.get("future"))
                    if _history_entry_size_ok(item)
                ]
                return {"past": past, "future": future}
            except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
                logger.warning("Could not read canvas history for %s: %s", doc_id, exc)
                return {"past": [], "future": []}

    def save_history(
        self,
        doc_id: str,
        past: list[dict[str, Any]],  # type: ignore[typeddict-item]
        future: list[dict[str, Any]],  # type: ignore[typeddict-item]
        max_history: int = 30,
    ) -> bool:
        with self._lock:
            path = self._history_path_for(str(doc_id))
            self.history_dir.mkdir(parents=True, exist_ok=True)
            norm_past: list[dict[str, Any]] = []  # type: ignore[typeddict-item]
            for d in past[-max_history:]:
                if not isinstance(d, dict):
                    continue
                item = self._normalize_history_item(d)
                if not _history_entry_size_ok(item):
                    logger.warning("Dropping oversized canvas history entry for %s", doc_id)
                    continue
                norm_past.append(item)
            norm_future: list[dict[str, Any]] = []  # type: ignore[typeddict-item]
            for d in future[-max_history:]:
                if not isinstance(d, dict):
                    continue
                item = self._normalize_history_item(d)
                if not _history_entry_size_ok(item):
                    logger.warning("Dropping oversized canvas history entry for %s", doc_id)
                    continue
                norm_future.append(item)
            payload = {"past": norm_past, "future": norm_future}
            encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
            if path.exists():
                try:
                    if path.read_text(encoding="utf-8") == encoded:
                        return True
                except OSError:
                    pass
            tmp = path.with_suffix(".json.tmp")
            tmp.write_text(encoded, encoding="utf-8")
            tmp.replace(path)
            return True

    def save(self, document: dict[str, Any], *, touch: bool = True) -> dict[str, Any]:  # type: ignore[typeddict-item]
        with self._lock:
            doc = normalize_document(document)
            if touch:
                doc["updatedAt"] = utc_now_iso()
            path = self._path_for(doc["id"])
            self.docs_dir.mkdir(parents=True, exist_ok=True)
            orphan = self._find_path_by_inner_id(doc["id"])
            if orphan is not None and orphan != path:
                with contextlib.suppress(OSError):
                    orphan.unlink()
                self._drop_index_entry(orphan.stem)
            encoded = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
            tmp = path.with_suffix(".json.tmp")
            tmp.write_text(encoded, encoding="utf-8")
            tmp.replace(path)
            self._refresh_index_entry(doc, path)
            return doc

    def create(self, *, name: str = "Sin título") -> dict[str, Any]:  # type: ignore[typeddict-item]
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
            self._drop_index_entry(path.stem)
            return True

    def _refresh_index_entry(self, doc: dict[str, Any], path: Path) -> None:  # type: ignore[typeddict-item]
        if self._index_stems is None:
            return
        stem = path.stem
        inner_id = str(doc.get("id") or "")
        self._inner_id_index = {k: v for k, v in self._inner_id_index.items() if v != path}
        self._index_stems.add(stem)
        if inner_id:
            self._inner_id_index[inner_id] = path
        entry = {"id": stem, "name": str(doc.get("name") or "Sin título"), "updatedAt": str(doc.get("updatedAt") or "")}
        self._listing_cache = [item for item in self._listing_cache if item["id"] != stem]
        self._listing_cache.append(entry)

    def _drop_index_entry(self, stem: str) -> None:
        if self._index_stems is None:
            return
        self._index_stems.discard(stem)
        self._inner_id_index = {k: v for k, v in self._inner_id_index.items() if v.stem != stem}
        self._listing_cache = [item for item in self._listing_cache if item["id"] != stem]

    def duplicate(self, doc_id: str, *, name: str | None = None) -> dict[str, Any]:  # type: ignore[typeddict-item]
        source = self.get(doc_id)
        if source is None:
            msg = f"Document not found: {doc_id}"
            raise ValueError(msg)
        existing = {item["name"] for item in self.list_documents()}
        return self.save(duplicate_document(source, name=name, existing_names=existing))
