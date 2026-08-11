import backend.core.config_theme as config_theme
from backend.core.config_theme import (
    DEFAULT_THEME,
    get_preset_names,
    load_preset,
    load_theme,
    reset_theme,
    save_theme,
)


def test_default_theme_uses_neutral_professional_identity() -> None:
    assert DEFAULT_THEME["name"] == "Slate Professional"
    assert DEFAULT_THEME["accent"] == "#3B82F6"
    assert DEFAULT_THEME["accent_light"] == "#93C5FD"
    assert DEFAULT_THEME["blue_hover"] == "#14B8A6"
    assert "Slate Professional" in get_preset_names()
    assert load_preset("Slate Professional")["name"] == "Slate Professional"


def test_save_and_load_theme_roundtrip(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(config_theme, "_CONFIG_PATH", tmp_path / "theme_config.json")
    theme = dict(DEFAULT_THEME)
    theme["name"] = "Vanta Black"
    theme["accent"] = "#00FF88"
    theme["mode"] = "dark"
    theme["pointer_cursors"] = "true"

    saved = save_theme(theme)
    assert saved["accent"] == "#00FF88"
    assert saved["mode"] == "dark"
    assert (tmp_path / "theme_config.json").exists()

    loaded = load_theme()
    assert loaded["accent"] == "#00FF88"
    assert loaded["mode"] == "dark"
    assert loaded["pointer_cursors"] == "true"
    assert loaded["name"] == "Vanta Black"


def test_load_theme_missing_file_returns_default(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(config_theme, "_CONFIG_PATH", tmp_path / "does_not_exist.json")
    assert load_theme() == DEFAULT_THEME


def test_load_theme_corrupt_file_returns_default(tmp_path, monkeypatch) -> None:
    bad = tmp_path / "theme_config.json"
    bad.write_text("{not valid json", encoding="utf-8")
    monkeypatch.setattr(config_theme, "_CONFIG_PATH", bad)
    assert load_theme() == DEFAULT_THEME


def test_load_theme_merges_partial_file_over_defaults(tmp_path, monkeypatch) -> None:
    partial = tmp_path / "theme_config.json"
    partial.write_text('{"bg": "#000000", "accent": "#123456", "mode": "light"}', encoding="utf-8")
    monkeypatch.setattr(config_theme, "_CONFIG_PATH", partial)

    loaded = load_theme()
    assert loaded["bg"] == "#000000"
    assert loaded["accent"] == "#123456"
    assert loaded["mode"] == "light"
    assert loaded["name"] == DEFAULT_THEME["name"]


def test_reset_theme_restores_defaults_on_disk(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(config_theme, "_CONFIG_PATH", tmp_path / "theme_config.json")
    custom = dict(DEFAULT_THEME)
    custom["accent"] = "#00FF88"
    save_theme(custom)

    reset = reset_theme()
    assert reset == DEFAULT_THEME
    assert load_theme() == DEFAULT_THEME


def test_all_presets_define_required_theme_keys() -> None:
    required = set(DEFAULT_THEME)
    for name in get_preset_names():
        preset = load_preset(name)
        assert required.issubset(preset.keys()), name


def test_preset_list_includes_varied_appearance_styles() -> None:
    names = set(get_preset_names())
    assert {"Porcelain Light", "Graphite Focus", "Olive Operations", "Copper Night", "Midnight Ocean", "Forest Zen", "Royal Purple", "Arctic Frost"}.issubset(names)
