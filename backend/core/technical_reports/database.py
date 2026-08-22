from __future__ import annotations

import sys
import threading
from pathlib import Path
from typing import Any

from backend.core.json_store import JsonDocumentStore, backup_corrupt_file
from backend.core.technical_reports.models import TechnicalReport, create_empty_report, next_technical_report_number
from backend.utils.paths import resource_path, user_data_path

DEFAULT_DB_PATH = user_data_path("technical_reports.json") if getattr(sys, "frozen", False) else resource_path("data/technical_reports.json")

_backup_corrupt_file = backup_corrupt_file

# Module-level singleton — prevents concurrent instances from clobbering each other's data.
_db_instance: TechnicalReportsDB | None = None
_db_instance_lock = threading.Lock()


def get_reports_db(db_path: str | Path | None = None) -> TechnicalReportsDB:
    """Return the process-wide TechnicalReportsDB singleton."""
    global _db_instance
    if _db_instance is None:
        with _db_instance_lock:
            if _db_instance is None:
                _db_instance = TechnicalReportsDB(db_path)
    return _db_instance


class TechnicalReportsDB(JsonDocumentStore):
    def __init__(self, db_path: str | Path | None = None) -> None:
        path = Path(db_path) if db_path is not None else Path(DEFAULT_DB_PATH)
        super().__init__(path, TechnicalReport.normalize)

    def get(self, report_id: str) -> dict[str, Any] | None:
        with self._lock:
            item = self._items.get(str(report_id))
            # Return a fresh normalized copy so edit forms cannot mutate storage.
            return TechnicalReport.normalize(item) if item else None

    def create(self, report: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            normalized = TechnicalReport.normalize(report)
            self._items[normalized["id"]] = normalized
            self._save()
            return normalized

    def create_empty(self) -> dict[str, Any]:
        with self._lock:
            next_id = next_technical_report_number(list(self._items.values()))
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
            normalized = TechnicalReport.normalize(payload)
            self._items[str(report_id)] = normalized
            self._save()
            return normalized

    def replace_all(self, reports: list[dict[str, Any]]) -> list[dict[str, Any]]:
        with self._lock:
            imported = [TechnicalReport.normalize(report) for report in reports]
            self._items = {report["id"]: report for report in imported}
            self._save()
            return imported

    def get_unique_cs(self) -> list[str]:
        """Return sorted unique CS values without full normalization overhead."""
        with self._lock:
            return sorted(
                {r.get("header", {}).get("cs", "") for r in self._items.values() if r.get("header", {}).get("cs")}
            )

    def get_unique_contratista(self, cs: str | None = None) -> list[str]:
        """Return sorted unique contratista values, optionally filtered by CS."""
        with self._lock:
            all_items = self._items.values()
            filtered_items = [r for r in all_items if r.get("header", {}).get("cs") == cs] if cs else list(all_items)
            return sorted(
                {r.get("header", {}).get("contratista", "") for r in filtered_items if r.get("header", {}).get("contratista")}
            )
