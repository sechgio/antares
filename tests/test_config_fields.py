"""Tests para la configuración personalizable de campos."""

from backend.core.config_fields import (
    DEFAULT_FIELDS,
    get_field_names,
    get_required_fields,
    get_unique_fields,
    load_fields,
    save_fields,
)


class TestConfigFields:
    def test_load_fields_retorna_defaults_sin_archivo(self, monkeypatch, tmp_path) -> None:
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: tmp_path / "no_existe.json",
        )
        fields = load_fields()
        assert len(fields) == len(DEFAULT_FIELDS)
        assert fields[0]["name"] == "codigo"

    def test_save_y_load_roundtrip(self, monkeypatch, tmp_path) -> None:
        config_path = tmp_path / "fields_config.json"
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: config_path,
        )

        custom = [
            {"name": "sku", "type": "TEXT", "required": True, "unique": True},
            {"name": "titulo", "type": "TEXT", "required": False, "unique": False},
        ]
        save_fields(custom)

        assert config_path.exists()
        loaded = load_fields()
        assert loaded[0]["name"] == "sku"
        assert loaded[0]["required"] is True
        assert loaded[1]["name"] == "titulo"

    def test_get_field_names(self, monkeypatch, tmp_path) -> None:
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: tmp_path / "fields_config.json",
        )
        save_fields([{"name": "a", "type": "TEXT"}, {"name": "b", "type": "INTEGER"}])
        assert get_field_names() == ["a", "b"]

    def test_get_required_fields(self, monkeypatch, tmp_path) -> None:
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: tmp_path / "fields_config.json",
        )
        save_fields([
            {"name": "a", "type": "TEXT", "required": True},
            {"name": "b", "type": "TEXT", "required": False},
        ])
        assert get_required_fields() == ["a"]

    def test_get_unique_fields(self, monkeypatch, tmp_path) -> None:
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: tmp_path / "fields_config.json",
        )
        save_fields([
            {"name": "a", "type": "TEXT", "unique": True},
            {"name": "b", "type": "TEXT", "unique": False},
        ])
        assert get_unique_fields() == ["a"]

    def test_corrupt_json_retorna_defaults(self, monkeypatch, tmp_path) -> None:
        config_path = tmp_path / "fields_config.json"
        config_path.write_text("NO ES JSON")
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: config_path,
        )
        fields = load_fields()
        assert fields[0]["name"] == "codigo"

    def test_normaliza_nombres_minusculas(self, monkeypatch, tmp_path) -> None:
        config_path = tmp_path / "fields_config.json"
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: config_path,
        )
        save_fields([{"name": "CODIGO", "type": "text"}])
        loaded = load_fields()
        assert loaded[0]["name"] == "codigo"
        assert loaded[0]["type"] == "TEXT"
