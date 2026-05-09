"""Tests for the plugin system."""

from backend.core import format_registry
from backend.core.plugins import load_plugins_from_dir


class TestPluginLoader:
    def test_loads_plugin_and_adds_format(self, tmp_path, monkeypatch):
        # Reset registry for test isolation
        registry = format_registry.FormatRegistry()
        monkeypatch.setattr(format_registry, "_registry", registry)

        plugins_dir = tmp_path / "plugins"
        plugins_dir.mkdir()
        (plugins_dir / "plugin_test.py").write_text(
            'def register(registry):\n    registry.add_format("HEICTST", ".heic", ("RGB", "RGBA"))\n'
        )
        load_plugins_from_dir(plugins_dir)
        assert "HEICTST" in registry.list_formats()
        assert registry["HEICTST"]["ext"] == ".heic"

    def test_skips_underscored_files(self, tmp_path, monkeypatch):
        registry = format_registry.FormatRegistry()
        monkeypatch.setattr(format_registry, "_registry", registry)

        plugins_dir = tmp_path / "plugins"
        plugins_dir.mkdir()
        (plugins_dir / "_private.py").write_text(
            'def register(registry):\n    registry.add_format("PRIVATE", ".prv", ("RGB",))\n'
        )
        load_plugins_from_dir(plugins_dir)
        assert "PRIVATE" not in registry.list_formats()

    def test_gracefully_handles_missing_register(self, tmp_path, monkeypatch):
        registry = format_registry.FormatRegistry()
        monkeypatch.setattr(format_registry, "_registry", registry)

        plugins_dir = tmp_path / "plugins"
        plugins_dir.mkdir()
        (plugins_dir / "no_register.py").write_text(
            'x = 1\n'
        )
        load_plugins_from_dir(plugins_dir)
        # Should not crash
        assert registry.list_formats() == []

    def test_gracefully_handles_broken_plugin(self, tmp_path, monkeypatch):
        registry = format_registry.FormatRegistry()
        monkeypatch.setattr(format_registry, "_registry", registry)

        plugins_dir = tmp_path / "plugins"
        plugins_dir.mkdir()
        (plugins_dir / "broken.py").write_text(
            'raise ValueError("boom")\n'
        )
        load_plugins_from_dir(plugins_dir)
        # Should not crash
        assert registry.list_formats() == []
