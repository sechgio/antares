from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from backend.core.json_store import JsonDocumentStore

ReportDocument = dict[str, Any]
ReportNormalizer = Callable[[ReportDocument], ReportDocument]
EmptyReportFactory = Callable[[int], ReportDocument]
NextReportNumber = Callable[[list[ReportDocument]], int]


def resolve_report_store_paths(
    db_path: str | Path | None,
    default_path: str | Path,
    default_user_data_path: str | Path,
    legacy_path: str | Path,
) -> tuple[Path, Path | None]:
    path = Path(db_path) if db_path is not None else Path(default_path)
    legacy = (
        Path(legacy_path)
        if db_path is None
        and not getattr(sys, "frozen", False)
        and path == Path(default_user_data_path)
        else None
    )
    return path, legacy


def next_report_number(reports: list[ReportDocument]) -> int:
    current = 0
    for report in reports:
        try:
            current = max(current, int(report.get("metadata", {}).get("informe_id", 0)))
        except (TypeError, ValueError):
            continue
    return current + 1


class ReportStore(JsonDocumentStore):
    def __init__(
        self,
        db_path: str | Path,
        normalizer: ReportNormalizer,
        empty_factory: EmptyReportFactory,
        next_number: NextReportNumber,
        legacy_path: str | Path | None = None,
    ) -> None:
        self._empty_factory = empty_factory
        self._next_number = next_number
        super().__init__(db_path, normalizer, legacy_path=legacy_path)

    def create(self, report: ReportDocument) -> ReportDocument:
        return self.insert(report)

    def create_empty(self) -> ReportDocument:
        with self._lock:
            next_number = self._next_number(list(self._items.values()))
            return self._commit(self._empty_factory(next_number))
