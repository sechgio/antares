from __future__ import annotations

import sys
import threading
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any

from backend.core.fichas_tecnicas.models import (
    FichaTecnica,
    create_empty_ficha,
    next_ficha_number,
)
from backend.core.json_store import JsonDocumentStore, backup_corrupt_file
from backend.utils.paths import resource_path, user_data_path

DEFAULT_DB_PATH = (
    user_data_path("fichas_tecnicas.json")
    if getattr(sys, "frozen", False)
    else resource_path("data/fichas_tecnicas.json")
)

_backup_corrupt_file = backup_corrupt_file

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


class FichasTecnicasDB(JsonDocumentStore):
    def __init__(self, db_path: str | Path | None = None) -> None:
        path = Path(db_path) if db_path is not None else Path(DEFAULT_DB_PATH)
        super().__init__(path, FichaTecnica.normalize)

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

    def replace_all(self, fichas: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
        with self._lock:
            deleted_count = len(self._items)
            imported = [FichaTecnica.normalize(f) for f in fichas]
            self._items = {f["id"]: f for f in imported}
            self._save()
            return [deepcopy(f) for f in imported], deleted_count
