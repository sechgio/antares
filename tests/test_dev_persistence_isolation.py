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


def test_formatos_storage_uses_user_data_path() -> None:
    from backend.core import formatos

    data_dir = resource_path("data").resolve()

    assert formatos._DATA_DIR.resolve() == user_data_path("formatos").resolve()
    assert formatos._UPLOADS_DIR.resolve() == user_data_path("formatos/uploads").resolve()
    assert formatos._CATALOG_PATH.resolve() == user_data_path("formatos/catalog.json").resolve()

    assert not formatos._DATA_DIR.resolve().is_relative_to(data_dir)
    assert not formatos._UPLOADS_DIR.resolve().is_relative_to(data_dir)
    assert not formatos._CATALOG_PATH.resolve().is_relative_to(data_dir)


def test_formatos_legacy_catalog_migrates_once(tmp_path: Path, monkeypatch) -> None:
    from backend.core import formatos

    legacy_dir = tmp_path / "legacy" / "formatos"
    legacy_uploads = legacy_dir / "uploads"
    legacy_uploads.mkdir(parents=True)
    (legacy_dir / "catalog.json").write_text("[]", encoding="utf-8")
    (legacy_uploads / "upload-abc_template.pdf").write_bytes(b"%PDF-legacy")

    data_dir = tmp_path / "user" / "formatos"
    uploads_dir = data_dir / "uploads"
    uploads_dir.mkdir(parents=True)

    monkeypatch.setattr(formatos, "_LEGACY_DATA_DIR", legacy_dir)
    monkeypatch.setattr(formatos, "_DATA_DIR", data_dir)
    monkeypatch.setattr(formatos, "_UPLOADS_DIR", uploads_dir)
    monkeypatch.setattr(formatos, "_CATALOG_PATH", data_dir / "catalog.json")

    formatos._migrate_legacy_data_dir()

    assert (data_dir / "catalog.json").is_file()
    assert (uploads_dir / "upload-abc_template.pdf").read_bytes() == b"%PDF-legacy"
    assert (legacy_dir / "catalog.json").is_file(), "la migración no debe destruir el origen"

    (data_dir / "catalog.json").write_text('[{"id": "nuevo"}]', encoding="utf-8")
    (legacy_dir / "catalog.json").write_text('[{"id": "viejo"}]', encoding="utf-8")
    formatos._migrate_legacy_data_dir()
    assert json.loads((data_dir / "catalog.json").read_text(encoding="utf-8")) == [{"id": "nuevo"}]


def test_bundled_data_template_integrity() -> None:
    fichas_file = Path(resource_path("data/fichas_tecnicas.json"))
    if fichas_file.exists():
        content = fichas_file.read_text(encoding="utf-8").strip()
        assert isinstance(json.loads(content), dict)
