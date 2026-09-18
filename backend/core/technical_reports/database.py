from __future__ import annotations

from pathlib import Path

from backend.core.report_store import ReportStore, resolve_report_store_paths
from backend.core.technical_reports.models import TechnicalReport, create_empty_report, next_technical_report_number
from backend.utils.lazy import LazySingleton
from backend.utils.paths import resource_path, user_data_path

DEFAULT_DB_PATH = user_data_path("technical_reports.json")
_DEFAULT_USER_DATA_PATH = DEFAULT_DB_PATH
_LEGACY_DB_PATH = resource_path("data/technical_reports.json")

class TechnicalReportsDB(ReportStore):
    not_found_template = "Informe no encontrado: {id}"

    def __init__(self, db_path: str | Path | None = None) -> None:
        path, legacy_path = resolve_report_store_paths(
            db_path,
            DEFAULT_DB_PATH,
            _DEFAULT_USER_DATA_PATH,
            _LEGACY_DB_PATH,
        )
        super().__init__(
            path,
            TechnicalReport.normalize,
            create_empty_report,
            next_technical_report_number,
            legacy_path=legacy_path,
        )

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


_db_singleton = LazySingleton(TechnicalReportsDB)


def get_reports_db(db_path: str | Path | None = None) -> TechnicalReportsDB:
    return _db_singleton.get(db_path)
