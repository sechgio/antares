
from __future__ import annotations

import pytest

from backend.core.run_types import (
    ALL_RUN_TYPES,
    RUN_TYPE_REGISTRY,
    validate_run_payload,
)


class TestRegistryShape:
    def test_all_run_types_contains_every_registered_id(self) -> None:
        assert set(ALL_RUN_TYPES) == set(RUN_TYPE_REGISTRY.keys())
        assert "sellador" in ALL_RUN_TYPES

    def test_each_meta_has_required_fields(self) -> None:
        for run_type, meta in RUN_TYPE_REGISTRY.items():
            assert meta.id == run_type
            assert meta.label_key.startswith("history.runTypes.")
            assert meta.color_token


class TestValidateRunPayload:
    def test_unknown_type_raises(self) -> None:
        with pytest.raises(ValueError, match="Unknown run_type"):
            validate_run_payload("inventado-2027", {}, [])

    def test_known_type_with_empty_payload_does_not_raise(self) -> None:
        validate_run_payload("padron", {}, [])

    def test_known_type_with_typical_conversion_payload(self) -> None:
        validate_run_payload(
            "conversion",
            {"formato": "JPEG", "calidad": 90, "keep_exif": True},
            ["file1.jpg", "file2.jpg"],
        )

    def test_files_must_be_non_empty_for_conversion(self) -> None:
        from jsonschema.exceptions import ValidationError

        with pytest.raises(ValidationError):
            validate_run_payload("conversion", {"formato": "JPEG"}, [])

    def test_calidad_must_be_in_range(self) -> None:
        from jsonschema.exceptions import ValidationError

        with pytest.raises(ValidationError):
            validate_run_payload("conversion", {"calidad": 250}, ["x.jpg"])

    def test_ficha_tecnica_plantilla_payload(self) -> None:
        validate_run_payload("ficha_tecnica", {"type": "plantilla"}, ["x.pdf"])

    def test_ficha_tecnica_individual_payload(self) -> None:
        validate_run_payload("ficha_tecnica", {"type": "individual", "fichaId": "abc"}, ["x.pdf"])

class TestSaveRunMetadata:
    def test_save_run_persists_app_version_and_schema_version(self, tmp_path, monkeypatch) -> None:
        import sqlite3

        from backend.core.history import _ensure_table, get_run, save_run
        from backend.version import __version__

        db_file = tmp_path / "test.db"
        monkeypatch.setattr("backend.core.history.get_db_path", lambda: db_file)

        _ensure_table()
        run_id = save_run(
            files=["photo.jpg"],
            options={"formato": "JPEG", "calidad": 90},
            patron="test",
            formato="JPEG",
            calidad=90,
            resize=None,
            ok_count=1,
            err_count=0,
            run_type="conversion",
            duration_ms=1200,
        )

        row = get_run(run_id)
        assert row is not None
        assert row["app_version"] == __version__
        assert row["schema_version"] == 1
        assert row["duration_ms"] == 1200

        with sqlite3.connect(str(db_file)) as conn:
            applied = {
                row[0]
                for row in conn.execute("SELECT id FROM _schema_migrations").fetchall()
            }
        assert "001_historial_baseline" in applied
        assert "002_historial_metadata" in applied
        assert "003_historial_indexes" in applied
