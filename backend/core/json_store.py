from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
import threading
from collections.abc import Callable
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any

from backend.core.exceptions import DatabaseError

logger = logging.getLogger(__name__)

_legacy_migration_lock = threading.Lock()


def _read_items(path: Path, normalizer: Callable[[dict[str, Any]], dict[str, Any]]) -> dict[str, dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        items = [normalizer(item) for item in raw if isinstance(item, dict)]
        return {str(item["id"]): item for item in items if item.get("id") is not None}
    if isinstance(raw, dict):
        return {
            str(item_id): normalizer(item)
            for item_id, item in raw.items()
            if isinstance(item, dict)
        }
    raise DatabaseError(f"Formato JSON incompatible en {path}")


def _atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        with tmp_path.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
    finally:
        tmp_path.unlink(missing_ok=True)


def _migration_marker_path(target_path: Path) -> Path:
    return target_path.with_name(f".{target_path.name}.legacy-v1.done")


def migrate_legacy_json_store(
    target_path: str | Path,
    legacy_path: str | Path | None,
    normalizer: Callable[[dict[str, Any]], dict[str, Any]],
) -> None:
    if legacy_path is None:
        return

    target = Path(target_path)
    legacy = Path(legacy_path)
    if target.resolve() == legacy.resolve() or not legacy.exists():
        return

    marker = _migration_marker_path(target)
    with _legacy_migration_lock:
        if marker.exists():
            return

        try:
            legacy_items = _read_items(legacy, normalizer)
        except json.JSONDecodeError:
            logger.warning("JSON legacy corrupto en %s; se omite la migración", legacy)
            return
        except (KeyError, TypeError, ValueError, DatabaseError):
            logger.warning("Formato JSON legacy incompatible en %s; se omite la migración", legacy)
            return

        target_exists = target.exists()
        target_items: dict[str, dict[str, Any]] = {}
        if target_exists:
            try:
                target_items = _read_items(target, normalizer)
            except json.JSONDecodeError:
                # Let JsonDocumentStore._load create its existing corruption backup and error.
                return
            except (KeyError, TypeError, ValueError, DatabaseError):
                # Do not replace an unexpected user file with legacy data.
                return

        merged = dict(legacy_items)
        merged.update(target_items)
        if merged != target_items:
            _atomic_write_text(
                target,
                json.dumps(merged, ensure_ascii=False, separators=(",", ":")),
            )

        _atomic_write_text(marker, "version=1\n")


def backup_corrupt_file(path: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    backup_path = path.with_name(f"{path.name}.corrupt.{timestamp}.bak")
    shutil.copy2(path, backup_path)
    return backup_path


class JsonDocumentStore:
    not_found_template = "Documento no encontrado: {id}"

    def __init__(
        self,
        db_path: str | Path,
        normalizer: Callable[[dict[str, Any]], dict[str, Any]],
        legacy_path: str | Path | None = None,
    ) -> None:
        self.db_path = Path(db_path)
        self._normalizer = normalizer
        self._lock = threading.RLock()
        self._items: dict[str, dict[str, Any]] = {}
        migrate_legacy_json_store(self.db_path, legacy_path, normalizer)
        self._load()

    def _load(self) -> None:
        with self._lock:
            if not self.db_path.exists():
                self._items = {}
                return
            try:
                raw = json.loads(self.db_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                try:
                    backup_path = backup_corrupt_file(self.db_path)
                except OSError as backup_exc:
                    msg = f"JSON corrupto en {self.db_path}; no se pudo crear el backup"
                    raise DatabaseError(msg) from backup_exc
                logger.error("JSON corrupto en %s; backup creado en %s", self.db_path, backup_path)
                msg = f"JSON corrupto en {self.db_path}; backup creado en {backup_path}"
                raise DatabaseError(msg) from exc

            if isinstance(raw, list):
                items = [self._normalizer(item) for item in raw if isinstance(item, dict)]
                self._items = {
                    str(item["id"]): item for item in items if item.get("id") is not None
                }
            elif isinstance(raw, dict):
                self._items = {
                    str(item_id): self._normalizer(item)
                    for item_id, item in raw.items()
                    if isinstance(item, dict)
                }
            else:
                self._items = {}

    def _save(self) -> None:
        content = json.dumps(self._items, ensure_ascii=False, separators=(",", ":"))
        _atomic_write_text(self.db_path, content)

    def get_all(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(item) for item in self._items.values()]

    def get(self, item_id: str) -> dict[str, Any] | None:
        with self._lock:
            item = self._items.get(str(item_id))
            if item is None:
                return None
            return deepcopy(self._normalizer(item))

    def _commit(self, normalized: dict[str, Any]) -> dict[str, Any]:
        item_id = str(normalized["id"])
        self._items[item_id] = normalized
        self._save()
        return deepcopy(normalized)

    def insert(self, item: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            return self._commit(self._normalizer(dict(item)))

    def update(self, item_id: str, item: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            key = str(item_id)
            if key not in self._items:
                raise KeyError(self.not_found_template.format(id=key))
            payload = dict(item)
            payload["id"] = key
            return self._commit(self._normalizer(payload))

    def replace_all_counted(self, items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
        with self._lock:
            deleted_count = len(self._items)
            imported = [self._normalizer(dict(item)) for item in items]
            self._items = {str(item["id"]): item for item in imported}
            self._save()
            return [deepcopy(item) for item in imported], deleted_count

    def delete(self, item_id: str) -> bool:
        with self._lock:
            existed = self._items.pop(str(item_id), None) is not None
            if existed:
                self._save()
            return existed

    def clear_all(self) -> int:
        with self._lock:
            count = len(self._items)
            self._items = {}
            self._save()
            return count
