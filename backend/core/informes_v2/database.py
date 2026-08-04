from __future__ import annotations

import json
import logging
import shutil
import sys
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

from backend.core.exceptions import DatabaseError
from backend.core.informes_v2.models import InformeV2, create_empty_report, next_informe_v2_number
from backend.utils.paths import resource_path, user_data_path

DEFAULT_DB_PATH = (
    user_data_path("informes_v2.json") if getattr(sys, "frozen", False) else resource_path("data/informes_v2.json")
)

logger = logging.getLogger(__name__)


def _backup_corrupt_file(path: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    backup_path = path.with_name(f"{path.name}.corrupt.{timestamp}.bak")
    shutil.copy2(path, backup_path)
    return backup_path


_db_instance: InformesV2DB | None = None
_db_instance_lock = threading.Lock()


def get_informes_v2_db(db_path: str | Path | None = None) -> InformesV2DB:
    global _db_instance
    if _db_instance is None:
        with _db_instance_lock:
            if _db_instance is None:
                _db_instance = InformesV2DB(db_path)
    return _db_instance


class InformesV2DB:
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
            except json.JSONDecodeError as exc:
                try:
                    backup_path = _backup_corrupt_file(self.db_path)
                except OSError as backup_exc:
                    msg = f"JSON corrupto en {self.db_path}; no se pudo crear el backup"
                    raise DatabaseError(msg) from backup_exc
                logger.error("JSON corrupto en %s; backup creado en %s", self.db_path, backup_path)
                msg = f"JSON corrupto en {self.db_path}; backup creado en {backup_path}"
                raise DatabaseError(msg) from exc
            if isinstance(raw, list):
                reports = [InformeV2.normalize(item) for item in raw if isinstance(item, dict)]
                self._items = {report["id"]: report for report in reports}
            elif isinstance(raw, dict):
                self._items = {
                    str(report_id): InformeV2.normalize(report)
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
            return [dict(item) for item in self._items.values()]

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
            imported = [InformeV2.normalize(report) for report in reports]
            self._items = {report["id"]: report for report in imported}
            self._save()
            return imported
