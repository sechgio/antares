"""Tests for the plugin system."""

from __future__ import annotations

import hashlib
import json

from backend.core import format_registry
from backend.core.plugins import load_plugins_from_dir


def _write_allowlisted_plugin(plugins_dir, filename: str, source: str) -> None:
    """Write a plugin and record its SHA-256 in allowlist.json."""
    (plugins_dir / filename).write_text(source, encoding="utf-8")
    allow_path = plugins_dir / "allowlist.json"
    allow: dict[str, str] = {}
    if allow_path.exists():
        allow = json.loads(allow_path.read_text(encoding="utf-8"))
    allow[filename] = hashlib.sha256(source.encode("utf-8")).hexdigest()
    allow_path.write_text(json.dumps(allow), encoding="utf-8")


class TestPluginLoader:
    def test_loads_plugin_and_adds_format(self, tmp_path, monkeypatch) -> None:
        # Reset registry for test isolation
        registry = format_registry.FormatRegistry()
        monkeypatch.setattr(format_registry, "_registry", registry)

        plugins_dir = tmp_path / "plugins"
        plugins_dir.mkdir()
        _write_allowlisted_plugin(
            plugins_dir,
            "plugin_test.py",
            'def register(registry):\n    registry.add_format("HEICTST", ".heic", ("RGB", "RGBA"))\n',
        )
        load_plugins_from_dir(plugins_dir)
        assert "HEICTST" in registry.list_formats()
        assert registry["HEICTST"]["ext"] == ".heic"

    def test_skips_underscored_files(self, tmp_path, monkeypatch) -> None:
        registry = format_registry.FormatRegistry()
        monkeypatch.setattr(format_registry, "_registry", registry)

        plugins_dir = tmp_path / "plugins"
        plugins_dir.mkdir()
        (plugins_dir / "_private.py").write_text(
            'def register(registry):\n    registry.add_format("PRIVATE", ".prv", ("RGB",))\n',
        )
        load_plugins_from_dir(plugins_dir)
        assert "PRIVATE" not in registry.list_formats()

    def test_gracefully_handles_missing_register(self, tmp_path, monkeypatch) -> None:
        registry = format_registry.FormatRegistry()
        monkeypatch.setattr(format_registry, "_registry", registry)

        plugins_dir = tmp_path / "plugins"
        plugins_dir.mkdir()
        (plugins_dir / "no_register.py").write_text(
            "x = 1\n",
        )
        load_plugins_from_dir(plugins_dir)
        # Should not crash
        assert registry.list_formats() == []

    def test_gracefully_handles_broken_plugin(self, tmp_path, monkeypatch) -> None:
        registry = format_registry.FormatRegistry()
        monkeypatch.setattr(format_registry, "_registry", registry)

        plugins_dir = tmp_path / "plugins"
        plugins_dir.mkdir()
        (plugins_dir / "broken.py").write_text(
            'raise ValueError("boom")\n',
        )
        load_plugins_from_dir(plugins_dir)
        # Should not crash
        assert registry.list_formats() == []

    def test_blocks_import_os(self, tmp_path, monkeypatch) -> None:
        registry = format_registry.FormatRegistry()
        monkeypatch.setattr(format_registry, "_registry", registry)
        plugins_dir = tmp_path / "plugins"
        plugins_dir.mkdir()
        (plugins_dir / "bad_os.py").write_text(
            "import os\n"
            "def register(registry):\n"
            '    registry.add_format("BADOS", ".bad", ("RGB",))\n',
        )
        load_plugins_from_dir(plugins_dir)
        assert "BADOS" not in registry.list_formats()

    def test_blocks_eval(self, tmp_path, monkeypatch) -> None:
        registry = format_registry.FormatRegistry()
        monkeypatch.setattr(format_registry, "_registry", registry)
        plugins_dir = tmp_path / "plugins"
        plugins_dir.mkdir()
        (plugins_dir / "bad_eval.py").write_text(
            "def register(registry):\n"
            '    eval("1+1")\n'
            '    registry.add_format("BADEVAL", ".bad", ("RGB",))\n',
        )
        load_plugins_from_dir(plugins_dir)
        assert "BADEVAL" not in registry.list_formats()

    def test_blocks_dunder_class_access(self, tmp_path, monkeypatch) -> None:
        registry = format_registry.FormatRegistry()
        monkeypatch.setattr(format_registry, "_registry", registry)
        plugins_dir = tmp_path / "plugins"
        plugins_dir.mkdir()
        (plugins_dir / "bad_dunder.py").write_text(
            "def register(registry):\n"
            "    _ = (1).__class__\n"
            '    registry.add_format("BADDUNDER", ".bad", ("RGB",))\n',
        )
        load_plugins_from_dir(plugins_dir)
        assert "BADDUNDER" not in registry.list_formats()

    def test_blocks_metaclass_keyword(self, tmp_path, monkeypatch) -> None:
        registry = format_registry.FormatRegistry()
        monkeypatch.setattr(format_registry, "_registry", registry)
        plugins_dir = tmp_path / "plugins"
        plugins_dir.mkdir()
        (plugins_dir / "bad_meta.py").write_text(
            "class M(type):\n"
            "    pass\n"
            "class X(metaclass=M):\n"
            "    pass\n"
            "def register(registry):\n"
            '    registry.add_format("BADMETA", ".bad", ("RGB",))\n',
        )
        load_plugins_from_dir(plugins_dir)
        assert "BADMETA" not in registry.list_formats()
