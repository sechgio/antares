"""HTML rendering parity for Fichas Técnicas logos/export markup."""

from __future__ import annotations

from backend.core.fichas_tecnicas.models import create_empty_ficha
from backend.core.fichas_tecnicas.rendering import render_consolidated_html, render_ficha_html


def test_render_ficha_html_embeds_logo_data_uris() -> None:
    ficha = create_empty_ficha()
    ficha["cliente"] = "Cliente Logo"

    html = render_ficha_html(
        ficha,
        logo_left="data:image/png;base64,LEFTFICHA",
        logo_right="data:image/webp;base64,RIGHTFICHA",
    )

    assert "Cliente Logo" in html
    assert 'src="data:image/png;base64,LEFTFICHA"' in html
    assert 'src="data:image/webp;base64,RIGHTFICHA"' in html
    assert 'alt="Logo"' in html
    assert 'alt="Logo derecho"' in html


def test_render_ficha_html_omits_logo_img_when_logos_absent() -> None:
    html = render_ficha_html(create_empty_ficha())

    assert 'alt="Logo"' not in html
    assert 'alt="Logo derecho"' not in html
    assert "data:image/" not in html


def test_render_consolidated_html_embeds_logos_on_each_ficha() -> None:
    a = create_empty_ficha()
    b = create_empty_ficha()
    a["cliente"] = "A"
    b["cliente"] = "B"

    html = render_consolidated_html(
        [a, b],
        logo_left="data:image/png;base64,L",
        logo_right="data:image/png;base64,R",
    )

    assert html.count('class="container"') == 2
    assert html.count('src="data:image/png;base64,L"') == 2
    assert html.count('src="data:image/png;base64,R"') == 2
