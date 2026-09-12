from __future__ import annotations

import sys
import threading
from pathlib import Path
from typing import Any

from backend.core.json_store import JsonDocumentStore
from backend.core.technical_reports.models import TechnicalReport, create_empty_report, next_technical_report_number
from backend.utils.paths import resource_path, user_data_path

DEFAULT_DB_PATH = user_data_path("technical_reports.json")
_DEFAULT_USER_DATA_PATH = DEFAULT_DB_PATH
_LEGACY_DB_PATH = resource_path("data/technical_reports.json")

_db_instance: TechnicalReportsDB | None = None
_db_instance_lock = threading.Lock()


def get_reports_db(db_path: str | Path | None = None) -> TechnicalReportsDB:
    global _db_instance
    if _db_instance is None:
        with _db_instance_lock:
            if _db_instance is None:
                _db_instance = TechnicalReportsDB(db_path)
    return _db_instance


class TechnicalReportsDB(JsonDocumentStore):
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
        super().__init__(path, TechnicalReport.normalize, legacy_path=legacy_path)

    def create(self, report: dict[str, Any]) -> dict[str, Any]:
        return self.insert(report)

    def create_empty(self) -> dict[str, Any]:
        with self._lock:
            next_id = next_technical_report_number(list(self._items.values()))
            return self._commit(create_empty_report(next_id))

    def get_unique_cs(self) -> list[str]:
        with self._lock:
            return sorted(
                {r.get("header", {}).get("cs", "") for r in self._items.values() if r.get("header", {}).get("cs")}
            )

    def get_unique_contratista(self, cs: str | None = None) -> list[str]:
        with self._lock:
            all_items = self._items.values()
            filtered_items = [r for r in all_items if r.get("header", {}).get("cs") == cs] if cs else list(all_items)
            return sorted(
                {r.get("header", {}).get("contratista", "") for r in filtered_items if r.get("header", {}).get("contratista")}
            )
