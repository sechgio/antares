from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from backend.core.editor.text import TextRenderError, render_text_bitmap, text_cache_key


def _text_clip(**over: object) -> dict[str, object]:
    clip: dict[str, object] = {
        "content": "Hola",
        "fontId": "dejavu-sans",
        "fontSizePx": 48,
        "color": "#FFFFFF",
        "align": "center",
        "box": {"x": 0.0, "y": 0.4, "width": 1.0, "height": 0.2},
        "style": {"bold": False, "italic": False, "underline": False, "strokeWidthPx": 0},
        "entryPreset": {"type": "none", "durationUs": 0},
        "exitPreset": {"type": "none", "durationUs": 0},
    }
    clip.update(over)
    return clip


@pytest.fixture()
def cache_dir(tmp_path: Path) -> Path:
    return tmp_path / "text-cache"


@pytest.fixture(autouse=True)
def allow_system_fonts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTARES_EDITOR_ALLOW_SYSTEM_FONTS", "1")


def test_renders_rgba_png_at_output_resolution(cache_dir: Path) -> None:
    out = render_text_bitmap(_text_clip(), 1280, 720, cache_dir=cache_dir)
    image = Image.open(out)
    assert image.format == "PNG"
    assert image.mode == "RGBA"
    assert image.size == (1280, 720)


def test_bitmap_is_transparent_outside_text(cache_dir: Path) -> None:
    out = render_text_bitmap(_text_clip(), 640, 360, cache_dir=cache_dir)
    image = Image.open(out)
    alpha = image.getchannel("A")
    corners = [alpha.getpixel(p) for p in [(2, 2), (637, 2), (2, 357), (637, 357)]]
    assert all(a == 0 for a in corners), f"esquinas con alfa: {corners}"


def test_text_actually_paints_something(cache_dir: Path) -> None:
    out = render_text_bitmap(_text_clip(), 640, 360, cache_dir=cache_dir)
    image = Image.open(out)
    alpha = image.getchannel("A")
    painted = sum(1 for value in alpha.getdata() if value > 0)
    assert painted > 100, "el bitmap no tiene píxeles pintados"


def test_cache_is_shared_between_preview_and_export(cache_dir: Path) -> None:
    clip = _text_clip()
    first = render_text_bitmap(clip, 1280, 720, cache_dir=cache_dir)
    second = render_text_bitmap(clip, 1280, 720, cache_dir=cache_dir)
    assert first == second
    assert first.is_file()
    assert len(list(cache_dir.glob("*.png"))) == 1


def test_cache_key_stable_for_same_params(cache_dir: Path) -> None:
    clip = _text_clip()
    assert text_cache_key(clip, 1280, 720) == text_cache_key(clip, 1280, 720)


def test_cache_key_changes_with_content(cache_dir: Path) -> None:
    a = text_cache_key(_text_clip(content="Hola"), 1280, 720)
    b = text_cache_key(_text_clip(content="Adiós"), 1280, 720)
    assert a != b


def test_unicode_accents_and_enye(cache_dir: Path) -> None:
    out = render_text_bitmap(_text_clip(content="Canción ñandú áéíóú"), 800, 400, cache_dir=cache_dir)
    image = Image.open(out)
    alpha = image.getchannel("A")
    painted = sum(1 for value in alpha.getdata() if value > 0)
    assert painted > 100


def test_emoji_renders_or_falls_back(cache_dir: Path) -> None:
    # Emoji fuera de la fuente: Pillow dibuja el glifo de reemplazo, no
    # falla. Lo importante es que el render nunca rompe.
    out = render_text_bitmap(_text_clip(content="Hola 🎬 mundo"), 800, 400, cache_dir=cache_dir)
    assert out.is_file()


def test_multiline_text_stays_in_canvas(cache_dir: Path) -> None:
    out = render_text_bitmap(
        _text_clip(content="Línea uno\nLínea dos\nLínea tres", box={"x": 0.1, "y": 0.1, "width": 0.8, "height": 0.8}),
        640,
        360,
        cache_dir=cache_dir,
    )
    image = Image.open(out)
    assert image.size == (640, 360)


def test_long_text_wraps_within_box(cache_dir: Path) -> None:
    out = render_text_bitmap(
        _text_clip(
            content="Este es un texto largo que debe ajustarse al ancho de la caja sin desbordar el lienzo",
            box={"x": 0.1, "y": 0.1, "width": 0.6, "height": 0.8},
        ),
        640,
        360,
        cache_dir=cache_dir,
    )
    image = Image.open(out)
    alpha = image.getchannel("A")
    right_edge = [alpha.getpixel((x, 180)) for x in range(630, 640)]
    assert all(a == 0 for a in right_edge), f"texto desbordado: {right_edge}"


def test_quotes_and_colons_do_not_execute(cache_dir: Path) -> None:
    out = render_text_bitmap(
        _text_clip(content="Dijo: \"hola\" [x]; a,b\\c"),
        800,
        400,
        cache_dir=cache_dir,
    )
    assert out.is_file()
    image = Image.open(out)
    alpha = image.getchannel("A")
    painted = sum(1 for value in alpha.getdata() if value > 0)
    assert painted > 50


def test_empty_content_rejected(cache_dir: Path) -> None:
    with pytest.raises(TextRenderError, match="contenido"):
        render_text_bitmap(_text_clip(content=""), 640, 360, cache_dir=cache_dir)


def test_non_positive_canvas_rejected(cache_dir: Path) -> None:
    with pytest.raises(TextRenderError, match="dimensiones"):
        render_text_bitmap(_text_clip(), 0, 360, cache_dir=cache_dir)


def test_bold_and_italic_render(cache_dir: Path) -> None:
    style = {"bold": True, "italic": True, "underline": False, "strokeWidthPx": 0}
    out = render_text_bitmap(_text_clip(style=style), 640, 360, cache_dir=cache_dir)
    image = Image.open(out)
    alpha = image.getchannel("A")
    painted = sum(1 for value in alpha.getdata() if value > 0)
    assert painted > 100


def test_stroke_and_underline_render(cache_dir: Path) -> None:
    style = {"bold": False, "italic": False, "underline": True, "strokeWidthPx": 3, "strokeColor": "#000000"}
    out = render_text_bitmap(_text_clip(style=style), 640, 360, cache_dir=cache_dir)
    image = Image.open(out)
    alpha = image.getchannel("A")
    painted = sum(1 for value in alpha.getdata() if value > 0)
    assert painted > 100


def test_alignment_variants_render(cache_dir: Path) -> None:
    for align in ("left", "center", "right"):
        out = render_text_bitmap(_text_clip(align=align), 640, 360, cache_dir=cache_dir)
        image = Image.open(out)
        alpha = image.getchannel("A")
        painted = sum(1 for value in alpha.getdata() if value > 0)
        assert painted > 50, f"alineación {align} sin píxeles"
