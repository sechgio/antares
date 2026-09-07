from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

from backend.core.informes_v2.models import InformeV2, create_empty_report, next_informe_v2_number
from backend.core.json_store import JsonDocumentStore
from backend.utils.paths import user_data_path

DEFAULT_DB_PATH = user_data_path("informes_v2.json")

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
        super().__init__(path, InformeV2.normalize)

    def create(self, report: dict[str, Any]) -> dict[str, Any]:
        return self.insert(report)

    def create_empty(self) -> dict[str, Any]:
        with self._lock:
            next_id = next_informe_v2_number(list(self._items.values()))
            return self._commit(create_empty_report(next_id))
