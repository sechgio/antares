from __future__ import annotations

import json
import sys
import threading
from pathlib import Path
from typing import Any

from backend.core.technical_reports.models import TechnicalReport, create_empty_report, next_technical_report_number
from backend.utils.paths import resource_path, user_data_path

DEFAULT_DB_PATH = user_data_path("technical_reports.json") if getattr(sys, "frozen", False) else resource_path("data/technical_reports.json")

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


class TechnicalReportsDB:
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
            except json.JSONDecodeError:
                raw = {}
            if isinstance(raw, list):
                reports = [TechnicalReport.normalize(item) for item in raw if isinstance(item, dict)]
                self._items = {report["id"]: report for report in reports}
            elif isinstance(raw, dict):
                self._items = {
                    str(report_id): TechnicalReport.normalize(report)
                    for report_id, report in raw.items()
                    if isinstance(report, dict)
                }
            else:
                self._items = {}

    def _save(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.db_path.with_suffix(self.db_path.suffix + ".tmp")
        tmp_path.write_text(json.dumps(self._items, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp_path.replace(self.db_path)

    def get_all(self) -> list[dict[str, Any]]:
        with self._lock:
            return [TechnicalReport.normalize(item) for item in self._items.values()]

    def get(self, report_id: str) -> dict[str, Any] | None:
        with self._lock:
            item = self._items.get(str(report_id))
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

    def delete(self, report_id: str) -> bool:
        with self._lock:
            existed = self._items.pop(str(report_id), None) is not None
            if existed:
                self._save()
            return existed

    def clear_all(self) -> int:
        with self._lock:
            count = len(self._items)
            self._items = {}
            self._save()
            return count

    def replace_all(self, reports: list[dict[str, Any]]) -> list[dict[str, Any]]:
        with self._lock:
            imported = [TechnicalReport.normalize(report) for report in reports]
            self._items = {report["id"]: report for report in imported}
            self._save()
            return imported
