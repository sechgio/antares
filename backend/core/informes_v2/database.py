from __future__ import annotations

from pathlib import Path

from backend.core.informes_v2.models import InformeV2, create_empty_report, next_informe_v2_number
from backend.core.report_store import ReportStore, resolve_report_store_paths
from backend.utils.lazy import LazySingleton
from backend.utils.paths import resource_path, user_data_path

DEFAULT_DB_PATH = user_data_path("informes_v2.json")
_DEFAULT_USER_DATA_PATH = DEFAULT_DB_PATH
_LEGACY_DB_PATH = resource_path("data/informes_v2.json")

class InformesV2DB(ReportStore):
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
            InformeV2.normalize,
            create_empty_report,
            next_informe_v2_number,
            legacy_path=legacy_path,
        )


_db_singleton = LazySingleton(InformesV2DB)


def get_informes_v2_db(db_path: str | Path | None = None) -> InformesV2DB:
    return _db_singleton.get(db_path)
