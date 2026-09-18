from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from backend.core.fichas_tecnicas.models import (
    FichaTecnica,
    create_empty_ficha,
    next_ficha_number,
)
from backend.core.report_store import ReportStore, resolve_report_store_paths
from backend.utils.lazy import LazySingleton
from backend.utils.paths import resource_path, user_data_path

DEFAULT_DB_PATH = user_data_path("fichas_tecnicas.json")
_DEFAULT_USER_DATA_PATH = DEFAULT_DB_PATH
_LEGACY_DB_PATH = resource_path("data/fichas_tecnicas.json")


class FichasTecnicasDB(ReportStore):
    not_found_template = "Ficha no encontrada: {id}"

    def __init__(self, db_path: str | Path | None = None) -> None:
        path, legacy_path = resolve_report_store_paths(
            db_path,
            DEFAULT_DB_PATH,
            _DEFAULT_USER_DATA_PATH,
            _LEGACY_DB_PATH,
        )
        super().__init__(
            path,
            FichaTecnica.normalize,
            create_empty_ficha,
            next_ficha_number,
            legacy_path=legacy_path,
        )

    def create(self, ficha: dict[str, Any] | None = None) -> dict[str, Any]:
        with self._lock:
            if isinstance(ficha, dict) and ficha:
                normalized = FichaTecnica.normalize(ficha)
                if not normalized.get("id") or normalized["id"] in self._items:
                    n = next_ficha_number(list(self._items.values()))
                    normalized["id"] = f"FT-{n:05d}"
                normalized["last_modified"] = datetime.now().isoformat()
            else:
                return self.create_empty()
            return self._commit(normalized)

    def update(self, ficha_id: str, ficha: dict[str, Any]) -> dict[str, Any]:
        payload = dict(ficha)
        payload["last_modified"] = datetime.now().isoformat()
        return super().update(ficha_id, payload)


_db_singleton = LazySingleton(FichasTecnicasDB)


def get_fichas_db(db_path: str | Path | None = None) -> FichasTecnicasDB:
    return _db_singleton.get(db_path)
