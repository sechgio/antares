from backend.core.informes_v2.models import create_empty_report
from backend.core.informes_v2.rendering import render_consolidated_html, render_report_html


def test_render_report_html_matches_preview_structure() -> None:
    report = create_empty_report(1)
    report["header"]["estacion"] = "R 900"
    report["header"]["distrito"] = "Villa El Salvador"
    report["valvulas"]["conduccion"]["diametros"]["4"] = 2
    html = render_report_html(
        report,
        logo_left="data:image/png;base64,left",
        logo_right="data:image/png;base64,right",
        images=None,
    )
    assert "VÁLVULAS" in html
    assert "LÍNEA" in html
    assert "MEDIDAS" in html
    assert 'class="iv2-corner-label"' in html
    assert 'class="iv2-photo-grid"' in html
    assert 'class="iv2-info"' in html
    assert "<strong>ESTACION:</strong>" in html
    assert "info-value" not in html
    assert "R 900" in html
    assert "Villa El Salvador" in html
    assert 'src="data:image/png;base64,left"' in html
    assert 'src="data:image/png;base64,right"' in html


def test_render_consolidated_with_images_by_id() -> None:
    a = create_empty_report(1)
    b = create_empty_report(2)
    a["header"]["estacion"] = "A"
    b["header"]["estacion"] = "B"
    html = render_consolidated_html(
        [a, b],
        images_by_id={
            a["id"]: [{"path": "data:image/jpeg;base64,xx", "name": "A-1.jpg"}],
        },
    )
    assert html.count('class="page"') == 2
    assert "data:image/jpeg;base64,xx" in html
    assert 'class="iv2-photo-cell"' in html
