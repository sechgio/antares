import json
from pathlib import Path

import backend.core.config_theme as config_theme
from backend.core.config_theme import (
    DEFAULT_THEME,
    load_preset,
    load_theme,
    reset_theme,
    save_theme,
)


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
    for name in config_theme.PRESETS:
        preset = load_preset(name)
        assert required.issubset(preset.keys()), name


def test_preset_list_includes_varied_appearance_styles() -> None:
    names = set(config_theme.PRESETS)
    assert {"Slate Modern", "Copper Night", "Bosque Operativo", "Twilight Lavender", "Stealth Black"}.issubset(names)
    assert not {"Vanta Black", "Porcelain Light", "Graphite Focus", "Royal Purple", "Arctic Frost"} & names


REPO_ROOT = Path(__file__).resolve().parent.parent


def _contrast(a: str, b: str) -> float:
    def lum(hex_color: str) -> float:
        channels = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        r, g, b = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    high, low = sorted((lum(a), lum(b)), reverse=True)
    return (high + 0.05) / (low + 0.05)


def test_presets_meet_contrast_floors() -> None:
    for name, preset in config_theme.PRESETS.items():
        bg = preset["bg"]
        assert _contrast(preset["fg"], bg) >= 7, name
        assert _contrast(preset["fg_muted"], bg) >= 4.5, name
        assert _contrast(preset["fg_tertiary"], bg) >= 3, name
        assert _contrast(preset["accent"], bg) >= 3, name


def test_default_theme_strictly_matches_shared_default_theme_json() -> None:
    shared_path = REPO_ROOT / "shared" / "default-theme.json"
    assert shared_path.is_file(), f"Missing shared contract: {shared_path}"
    shared_theme = json.loads(shared_path.read_text(encoding="utf-8"))

    assert shared_theme == DEFAULT_THEME
    assert shared_theme == load_preset("Slate Modern")


def test_frontend_theme_contract_parity() -> None:
    frontend_applier = REPO_ROOT / "frontend" / "src" / "utils" / "themeApplier.ts"
    assert frontend_applier.is_file(), f"Missing frontend themeApplier: {frontend_applier}"
    applier_text = frontend_applier.read_text(encoding="utf-8")
    assert "shared/default-theme.json" in applier_text, (
        "frontend themeApplier.ts must import single source shared/default-theme.json"
    )
    assert "export const DEFAULT_THEME" in applier_text

    appearance_view = (
        REPO_ROOT
        / "frontend"
        / "src"
        / "components"
        / "settings"
        / "AppearanceView.tsx"
    )
    assert appearance_view.is_file(), f"Missing AppearanceView: {appearance_view}"
    view_text = appearance_view.read_text(encoding="utf-8")
    assert "DEFAULT_THEME" in view_text
    assert "bg: '#0F172A'" not in view_text, "AppearanceView.tsx must not hardcode theme colors"

