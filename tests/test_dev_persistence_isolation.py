from __future__ import annotations

import json
from pathlib import Path

from backend.core.fichas_tecnicas.database import DEFAULT_DB_PATH as FT_PATH
from backend.core.informes_v2.database import DEFAULT_DB_PATH as INF_PATH
from backend.core.technical_reports.database import DEFAULT_DB_PATH as TR_PATH
from backend.utils.paths import resource_path, user_data_path


def test_default_db_paths_use_user_data_path() -> None:
    data_dir = resource_path("data").resolve()

    assert FT_PATH.resolve() == user_data_path("fichas_tecnicas.json").resolve()
    assert INF_PATH.resolve() == user_data_path("informes_v2.json").resolve()
    assert TR_PATH.resolve() == user_data_path("technical_reports.json").resolve()

    assert not FT_PATH.resolve().is_relative_to(data_dir)
    assert not INF_PATH.resolve().is_relative_to(data_dir)
    assert not TR_PATH.resolve().is_relative_to(data_dir)


def test_bundled_data_template_integrity() -> None:
    fichas_file = Path(resource_path("data/fichas_tecnicas.json"))
    if fichas_file.exists():
        content = fichas_file.read_text(encoding="utf-8").strip()
        assert isinstance(json.loads(content), dict)
