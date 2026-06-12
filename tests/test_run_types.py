"""Tests for the RunType registry and payload validation."""

from __future__ import annotations

import pytest

from backend.core.run_types import (
    ALL_RUN_TYPES,
    RUN_TYPE_REGISTRY,
    UNKNOWN_RUN_TYPE,
    get_run_type,
    registry_payload,
    validate_run_payload,
)


class TestRegistryShape:
    def test_all_run_types_contains_every_registered_id(self) -> None:
        assert set(ALL_RUN_TYPES) == set(RUN_TYPE_REGISTRY.keys())

    def test_each_meta_has_required_fields(self) -> None:
        for run_type, meta in RUN_TYPE_REGISTRY.items():
            assert meta.id == run_type
            assert meta.label_key.startswith("history.runTypes.")
            assert meta.color_token

    def test_get_run_type_returns_meta_for_known(self) -> None:
        meta = get_run_type("conversion")
        assert meta is RUN_TYPE_REGISTRY["conversion"]

    def test_get_run_type_returns_unknown_for_missing(self) -> None:
        meta = get_run_type("not-a-real-type")
        assert meta is UNKNOWN_RUN_TYPE

    def test_registry_payload_is_json_serializable(self) -> None:
        import json

        payload = registry_payload()
        # Round-trip through json.dumps; must not raise.
        text = json.dumps(payload)
        assert text  # non-empty
        assert payload["all_run_types"] == ALL_RUN_TYPES
        assert {rt["id"] for rt in payload["run_types"]} == set(ALL_RUN_TYPES)


class TestValidateRunPayload:
    def test_unknown_type_raises(self) -> None:
        with pytest.raises(ValueError, match="Unknown run_type"):
            validate_run_payload("inventado-2027", {}, [])

    def test_known_type_with_empty_payload_does_not_raise(self) -> None:
        # Padron schema is permissive — empty options / files are valid.
        validate_run_payload("padron", {}, [])

    def test_known_type_with_typical_conversion_payload(self) -> None:
        validate_run_payload(
            "conversion",
            {"formato": "JPEG", "calidad": 90, "keep_exif": True},
            ["file1.jpg", "file2.jpg"],
        )

    def test_files_must_be_non_empty_for_conversion(self) -> None:
        # The conversion schema requires at least one file.
        from jsonschema.exceptions import ValidationError

        with pytest.raises(ValidationError):
            validate_run_payload("conversion", {"formato": "JPEG"}, [])

    def test_calidad_must_be_in_range(self) -> None:
        from jsonschema.exceptions import ValidationError

        with pytest.raises(ValidationError):
            validate_run_payload("conversion", {"calidad": 250}, ["x.jpg"])


class TestHandlerIntegration:
    def test_history_schema_handler_is_registered(self) -> None:
        from backend.handlers.history import HANDLERS

        assert "history_schema" in HANDLERS
        result = HANDLERS["history_schema"]({})
        assert "run_types" in result
        assert "all_run_types" in result
        assert "current_version" in result


class TestHistoryConstants:
    def test_history_all_run_types_matches_registry(self) -> None:
        from backend.core.history import ALL_RUN_TYPES as history_types

        assert set(history_types) == set(RUN_TYPE_REGISTRY.keys())
        assert "sellador" in history_types


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
