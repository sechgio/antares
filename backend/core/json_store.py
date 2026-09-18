from __future__ import annotations

import json
import logging
import shutil
import threading
from collections.abc import Callable
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any

from backend.core.exceptions import DatabaseError
from backend.utils.atomic_write import atomic_write_text

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


def _copy_item(item: dict[str, Any]) -> dict[str, Any]:
    return deepcopy(item)


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
            atomic_write_text(
                target,
                json.dumps(merged, ensure_ascii=False, separators=(",", ":")),
            )

        atomic_write_text(marker, "version=1\n")


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
        self._encoded_items: dict[str, str] = {}
        migrate_legacy_json_store(self.db_path, legacy_path, normalizer)
        self._load()

    def _load(self) -> None:
        with self._lock:
            if not self.db_path.exists():
                self._items = {}
                self._encoded_items = {}
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
            self._encoded_items = {}

    def _save(self, items: dict[str, dict[str, Any]]) -> None:
        encoded_items: dict[str, str] = {}
        parts: list[str] = []
        for item_id, item in items.items():
            encoded = (
                self._encoded_items[item_id]
                if self._items.get(item_id) is item and item_id in self._encoded_items
                else json.dumps(item, ensure_ascii=False, separators=(",", ":"))
            )
            encoded_items[item_id] = encoded
            parts.append(f"{json.dumps(item_id, ensure_ascii=False)}:{encoded}")
        content = "{" + ",".join(parts) + "}"
        atomic_write_text(self.db_path, content)
        self._encoded_items = encoded_items

    def get_all(self) -> list[dict[str, Any]]:
        with self._lock:
            return [_copy_item(item) for item in self._items.values()]

    def get_many(self, item_ids: list[str]) -> list[dict[str, Any]]:  # allowlist: dict[str, Any]
        allowed = {str(item_id) for item_id in item_ids}
        with self._lock:
            return [_copy_item(item) for item_id, item in self._items.items() if item_id in allowed]

    def project_all(
        self,
        projector: Callable[[dict[str, Any]], dict[str, Any]],  # allowlist: dict[str, Any]
        predicate: Callable[[dict[str, Any]], bool] | None = None,  # allowlist: dict[str, Any]
    ) -> list[dict[str, Any]]:  # allowlist: dict[str, Any]
        with self._lock:
            return [
                deepcopy(projector(item))
                for item in self._items.values()
                if predicate is None or predicate(item)
            ]

    def get(self, item_id: str) -> dict[str, Any] | None:
        with self._lock:
            item = self._items.get(str(item_id))
            if item is None:
                return None
            return _copy_item(item)

    def _commit(self, normalized: dict[str, Any]) -> dict[str, Any]:
        item_id = str(normalized["id"])
        next_items = {**self._items, item_id: normalized}
        self._save(next_items)
        self._items = next_items
        return _copy_item(normalized)

    def insert(self, item: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            return self._commit(self._normalizer(deepcopy(item)))

    def update(self, item_id: str, item: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            key = str(item_id)
            if key not in self._items:
                raise KeyError(self.not_found_template.format(id=key))
            payload = deepcopy(item)
            payload["id"] = key
            return self._commit(self._normalizer(payload))

    def replace_all_counted(self, items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
        with self._lock:
            deleted_count = len(self._items)
            imported = [self._normalizer(deepcopy(item)) for item in items]
            next_items = {str(item["id"]): item for item in imported}
            self._save(next_items)
            self._items = next_items
            return [_copy_item(item) for item in imported], deleted_count

    def delete(self, item_id: str) -> bool:
        with self._lock:
            key = str(item_id)
            if key not in self._items:
                return False
            next_items = {k: v for k, v in self._items.items() if k != key}
            self._save(next_items)
            self._items = next_items
            return True

    def clear_all(self) -> int:
        with self._lock:
            count = len(self._items)
            self._save({})
            self._items = {}
            return count
