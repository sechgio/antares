
from __future__ import annotations

from backend.core import config_patterns
from backend.core.config_patterns import DEFAULT_PATTERNS, load_patterns, save_patterns


class TestConfigPatterns:
    def test_load_defaults_without_file(self, monkeypatch, tmp_path) -> None:
        monkeypatch.setattr(
            "backend.core.config_patterns._config_file",
            lambda: tmp_path / "missing.json",
        )
        config_patterns._store.invalidate()
        patterns = load_patterns()
        assert len(patterns) == len(DEFAULT_PATTERNS)

    def test_save_roundtrip_atomic(self, monkeypatch, tmp_path) -> None:
        config_path = tmp_path / "rename_patterns.json"
        monkeypatch.setattr(
            "backend.core.config_patterns._config_file",
            lambda: config_path,
        )
        config_patterns._store.invalidate()
        monkeypatch.setattr(
            "backend.core.config_patterns.get_field_names",
            lambda: ["codigo", "nombre"],
        )

        custom = [
            {"id": "custom", "label": "Custom", "pattern": "{codigo}_{seq}{ext}"},
        ]
        save_patterns(custom)
        assert config_path.exists()
        assert not config_path.with_suffix(config_path.suffix + ".tmp").exists()

        config_patterns._store.invalidate()
        loaded = load_patterns()
        assert loaded[0]["id"] == "custom"
        assert loaded[0]["pattern"] == "{codigo}_{seq}{ext}"
