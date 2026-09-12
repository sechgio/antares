from __future__ import annotations

import sys
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

from backend.core.fichas_tecnicas.models import (
    FichaTecnica,
    create_empty_ficha,
    next_ficha_number,
)
from backend.core.json_store import JsonDocumentStore
from backend.utils.paths import resource_path, user_data_path

DEFAULT_DB_PATH = user_data_path("fichas_tecnicas.json")
_DEFAULT_USER_DATA_PATH = DEFAULT_DB_PATH
_LEGACY_DB_PATH = resource_path("data/fichas_tecnicas.json")

_db_instance: FichasTecnicasDB | None = None
_db_instance_lock = threading.Lock()


def get_fichas_db(db_path: str | Path | None = None) -> FichasTecnicasDB:
    global _db_instance
    if _db_instance is None:
        with _db_instance_lock:
            if _db_instance is None:
                _db_instance = FichasTecnicasDB(db_path)
    return _db_instance


class FichasTecnicasDB(JsonDocumentStore):
    not_found_template = "Ficha no encontrada: {id}"

    def __init__(self, db_path: str | Path | None = None) -> None:
        path = Path(db_path) if db_path is not None else Path(DEFAULT_DB_PATH)
        legacy_path = (
            _LEGACY_DB_PATH
            if db_path is None
            and not getattr(sys, "frozen", False)
            and path == Path(_DEFAULT_USER_DATA_PATH)
            else None
        )
        super().__init__(path, FichaTecnica.normalize, legacy_path=legacy_path)

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
            return self._commit(normalized)

    def update(self, ficha_id: str, ficha: dict[str, Any]) -> dict[str, Any]:
        payload = dict(ficha)
        payload["last_modified"] = datetime.now().isoformat()
        return super().update(ficha_id, payload)
