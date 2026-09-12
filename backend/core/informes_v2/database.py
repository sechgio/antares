from __future__ import annotations

import sys
import threading
from pathlib import Path
from typing import Any

from backend.core.informes_v2.models import InformeV2, create_empty_report, next_informe_v2_number
from backend.core.json_store import JsonDocumentStore
from backend.utils.paths import resource_path, user_data_path

DEFAULT_DB_PATH = user_data_path("informes_v2.json")
_DEFAULT_USER_DATA_PATH = DEFAULT_DB_PATH
_LEGACY_DB_PATH = resource_path("data/informes_v2.json")

_db_instance: InformesV2DB | None = None
_db_instance_lock = threading.Lock()


def get_informes_v2_db(db_path: str | Path | None = None) -> InformesV2DB:
    global _db_instance
    if _db_instance is None:
        with _db_instance_lock:
            if _db_instance is None:
                _db_instance = InformesV2DB(db_path)
    return _db_instance


class InformesV2DB(JsonDocumentStore):
    not_found_template = "Informe no encontrado: {id}"

    def __init__(self, db_path: str | Path | None = None) -> None:
        path = Path(db_path) if db_path is not None else Path(DEFAULT_DB_PATH)
        legacy_path = (
            _LEGACY_DB_PATH
            if db_path is None
            and not getattr(sys, "frozen", False)
            and path == Path(_DEFAULT_USER_DATA_PATH)
            else None
        )
        super().__init__(path, InformeV2.normalize, legacy_path=legacy_path)

    def create(self, report: dict[str, Any]) -> dict[str, Any]:
        return self.insert(report)

    def create_empty(self) -> dict[str, Any]:
        with self._lock:
            next_id = next_informe_v2_number(list(self._items.values()))
            return self._commit(create_empty_report(next_id))
