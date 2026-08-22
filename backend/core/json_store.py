"""Generic thread-safe JSON file document store with corrupt-file recovery."""
from __future__ import annotations

import json
import logging
import shutil
import threading
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from backend.core.exceptions import DatabaseError

logger = logging.getLogger(__name__)


def backup_corrupt_file(path: Path) -> Path:
    """Create a dated backup of a corrupt JSON file."""
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    backup_path = path.with_name(f"{path.name}.corrupt.{timestamp}.bak")
    shutil.copy2(path, backup_path)
    return backup_path


class JsonDocumentStore:
    """Thread-safe JSON document store with atomic writes and corrupt file recovery."""

    def __init__(
        self,
        db_path: str | Path,
        normalizer: Callable[[dict[str, Any]], dict[str, Any]],
    ) -> None:
        self.db_path = Path(db_path)
        self._normalizer = normalizer
        self._lock = threading.RLock()
        self._items: dict[str, dict[str, Any]] = {}
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
                self._items = {item["id"]: item for item in items}
            elif isinstance(raw, dict):
                self._items = {
                    str(item_id): self._normalizer(item)
                    for item_id, item in raw.items()
                    if isinstance(item, dict)
                }
            else:
                self._items = {}

    def _save(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.db_path.with_suffix(self.db_path.suffix + ".tmp")
        tmp_path.write_text(json.dumps(self._items, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        tmp_path.replace(self.db_path)

    def get_all(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(item) for item in self._items.values()]

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
