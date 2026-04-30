from backend.core.config_theme import DEFAULT_THEME, get_preset_names, load_preset


def test_default_theme_uses_neutral_professional_identity() -> None:
    assert DEFAULT_THEME["name"] == "Slate Professional"
    assert DEFAULT_THEME["accent"] == "#3B82F6"
    assert DEFAULT_THEME["accent_light"] == "#93C5FD"
    assert DEFAULT_THEME["blue_hover"] == "#14B8A6"
    assert "Slate Professional" in get_preset_names()
    assert load_preset("Slate Professional")["name"] == "Slate Professional"


def test_all_presets_define_required_theme_keys() -> None:
    required = set(DEFAULT_THEME)
    for name in get_preset_names():
        preset = load_preset(name)
        assert required.issubset(preset.keys()), name


def test_preset_list_includes_varied_appearance_styles() -> None:
    names = set(get_preset_names())
    assert {"Porcelain Light", "Graphite Focus", "Olive Operations", "Copper Night", "Midnight Ocean", "Forest Zen", "Royal Purple", "Arctic Frost"}.issubset(names)
