from backend.core.config_theme import DEFAULT_THEME, get_preset_names, load_preset


def test_default_theme_uses_precision_linear_identity() -> None:
    assert DEFAULT_THEME["name"] == "Precision Linear"
    assert DEFAULT_THEME["accent"] == "#5E6AD2"
    assert DEFAULT_THEME["accent_light"] == "#8B93FF"
    assert DEFAULT_THEME["blue_hover"] == "#22C7A9"
    assert "Precision Linear" in get_preset_names()
    assert load_preset("Precision Linear")["name"] == "Precision Linear"


def test_all_presets_define_required_theme_keys() -> None:
    required = set(DEFAULT_THEME)
    for name in get_preset_names():
        preset = load_preset(name)
        assert required.issubset(preset.keys()), name


def test_preset_list_includes_varied_appearance_styles() -> None:
    names = set(get_preset_names())
    assert {"Solar Claro", "Bosque Operativo", "Amanecer Ambar", "Neon Grid"}.issubset(names)
