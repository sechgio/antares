"""JSON file persistence for Fichas Técnicas."""

from __future__ import annotations

import json
import logging
import shutil
import sys
import threading
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any

from backend.core.exceptions import DatabaseError
from backend.core.fichas_tecnicas.models import (
    FichaTecnica,
    create_empty_ficha,
    next_ficha_number,
)
from backend.utils.paths import resource_path, user_data_path

DEFAULT_DB_PATH = (
    user_data_path("fichas_tecnicas.json")
    if getattr(sys, "frozen", False)
    else resource_path("data/fichas_tecnicas.json")
)

logger = logging.getLogger(__name__)


def _backup_corrupt_file(path: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    backup_path = path.with_name(f"{path.name}.corrupt.{timestamp}.bak")
    shutil.copy2(path, backup_path)
    return backup_path


_db_instance: FichasTecnicasDB | None = None
_db_instance_lock = threading.Lock()


def get_fichas_db(db_path: str | Path | None = None) -> FichasTecnicasDB:
    """Return the process-wide FichasTecnicasDB singleton."""
    global _db_instance
    if _db_instance is None:
        with _db_instance_lock:
            if _db_instance is None:
                _db_instance = FichasTecnicasDB(db_path)
    return _db_instance


class FichasTecnicasDB:
    def __init__(self, db_path: str | Path | None = None) -> None:
        self.db_path = Path(db_path) if db_path is not None else Path(DEFAULT_DB_PATH)
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
                    backup_path = _backup_corrupt_file(self.db_path)
                except OSError as backup_exc:
                    msg = f"JSON corrupto en {self.db_path}; no se pudo crear el backup"
                    raise DatabaseError(msg) from backup_exc
                logger.error("JSON corrupto en %s; backup creado en %s", self.db_path, backup_path)
                msg = f"JSON corrupto en {self.db_path}; backup creado en {backup_path}"
                raise DatabaseError(msg) from exc
            if isinstance(raw, list):
                fichas = [FichaTecnica.normalize(item) for item in raw if isinstance(item, dict)]
                self._items = {f["id"]: f for f in fichas}
            elif isinstance(raw, dict):
                self._items = {
                    str(fid): FichaTecnica.normalize(ficha)
                    for fid, ficha in raw.items()
                    if isinstance(ficha, dict)
                }
            else:
                self._items = {}

    def _save(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.db_path.with_suffix(self.db_path.suffix + ".tmp")
        tmp_path.write_text(json.dumps(self._items, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp_path.replace(self.db_path)

    def get_all(self) -> list[dict[str, Any]]:
        # Shallow top-level copies for list/summary. Nested structures are
        # treated as read-only; callers that mutate must use get()/update().
        with self._lock:
            return [dict(item) for item in self._items.values()]

    def get(self, ficha_id: str) -> dict[str, Any] | None:
        with self._lock:
            item = self._items.get(str(ficha_id))
            return deepcopy(item) if item else None

    def create(self, ficha: dict[str, Any] | None = None) -> dict[str, Any]:
        with self._lock:
            if isinstance(ficha, dict) and ficha:
                normalized = FichaTecnica.normalize(ficha)
                if not normalized.get("id") or normalized["id"] in self._items:
                    n = next_ficha_number(list(self._items.values()))
                    normalized["id"] = f"FT-{n:05d}"
                normalized["last_modified"] = datetime.now().isoformat()
            else:
                n = next_ficha_number(list(self._items.values()))
                normalized = create_empty_ficha(n)
            self._items[normalized["id"]] = normalized
            self._save()
            return deepcopy(normalized)

    def update(self, ficha_id: str, ficha: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            if str(ficha_id) not in self._items:
                msg = f"Ficha no encontrada: {ficha_id}"
                raise KeyError(msg)
            payload = dict(ficha)
            payload["id"] = str(ficha_id)
            payload["last_modified"] = datetime.now().isoformat()
            normalized = FichaTecnica.normalize(payload)
            self._items[str(ficha_id)] = normalized
            self._save()
            return deepcopy(normalized)

    def delete(self, ficha_id: str) -> bool:
        with self._lock:
            existed = self._items.pop(str(ficha_id), None) is not None
            if existed:
                self._save()
            return existed

    def clear_all(self) -> int:
        with self._lock:
            count = len(self._items)
            self._items = {}
            self._save()
            return count

    def replace_all(self, fichas: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
        with self._lock:
            deleted_count = len(self._items)
            imported = [FichaTecnica.normalize(f) for f in fichas]
            self._items = {f["id"]: f for f in imported}
            self._save()
            return [deepcopy(f) for f in imported], deleted_count
