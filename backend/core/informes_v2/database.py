from __future__ import annotations

import sys
import threading
from pathlib import Path
from typing import Any

from backend.core.informes_v2.models import InformeV2, create_empty_report, next_informe_v2_number
from backend.core.json_store import JsonDocumentStore, backup_corrupt_file
from backend.utils.paths import resource_path, user_data_path

DEFAULT_DB_PATH = (
    user_data_path("informes_v2.json") if getattr(sys, "frozen", False) else resource_path("data/informes_v2.json")
)

_backup_corrupt_file = backup_corrupt_file

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
    def __init__(self, db_path: str | Path | None = None) -> None:
        path = Path(db_path) if db_path is not None else Path(DEFAULT_DB_PATH)
        super().__init__(path, InformeV2.normalize)

    def get(self, report_id: str) -> dict[str, Any] | None:
        with self._lock:
            item = self._items.get(str(report_id))
            return InformeV2.normalize(item) if item else None

    def create(self, report: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            normalized = InformeV2.normalize(report)
            self._items[normalized["id"]] = normalized
            self._save()
            return normalized

    def create_empty(self) -> dict[str, Any]:
        with self._lock:
            next_id = next_informe_v2_number(list(self._items.values()))
            report = create_empty_report(next_id)
            self._items[report["id"]] = report
            self._save()
            return report

    def update(self, report_id: str, report: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            if str(report_id) not in self._items:
                msg = f"Informe no encontrado: {report_id}"
                raise KeyError(msg)
            payload = dict(report)
            payload["id"] = str(report_id)
            normalized = InformeV2.normalize(payload)
            self._items[str(report_id)] = normalized
            self._save()
            return normalized

    def replace_all(self, reports: list[dict[str, Any]]) -> list[dict[str, Any]]:
        with self._lock:
            imported = [InformeV2.normalize(report) for report in reports]
            self._items = {report["id"]: report for report in imported}
            self._save()
            return imported
