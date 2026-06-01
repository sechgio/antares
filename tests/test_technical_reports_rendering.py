import re

from backend.core.technical_reports.models import create_empty_report
from backend.core.technical_reports.rendering import render_consolidated_html, render_report_html


def test_render_report_html_contains_report_fields() -> None:
    report = create_empty_report(2)
    report["header"]["codigo_infraestructura"] = "RES-99"

    html = render_report_html(report)

    assert "Informe Técnico" in html
    assert "RES-99" in html
    assert "page-container" in html


def test_render_report_html_shows_sgio_next_to_contratista() -> None:
    report = create_empty_report(3)
    report["header"]["contratista"] = "ACCIONA"
    report["header"]["sgio"] = "454654001"

    html = render_report_html(report)

    assert "CONTRATISTA" in html
    assert "ACCIONA" in html
    assert "SGIO" in html
    assert "454654001" in html


def test_render_report_html_preserves_red_critical_checks() -> None:
    report = create_empty_report(5)
    report["inspeccion"]["descarga"] = "critico"

    html = render_report_html(report)

    assert re.search(r'<span\s+class="check-critico">\s*X\s*</span>', html)


def test_render_consolidated_html_renders_multiple_pages() -> None:
    reports = [create_empty_report(1), create_empty_report(2)]

    html = render_consolidated_html(reports)

    assert len(re.findall(r'<div class="page-container">', html)) == 2


def test_render_report_html_sums_valvulas_and_canastillas_by_diameter() -> None:
    report = create_empty_report(7)
    report["valvulas"]["impulsion"]["8"] = 1
    report["valvulas"]["aduccion"]["10"] = 1
    report["valvulas"]["bypass"]["10"] = 1
    report["valvulas"]["desague"]["10"] = 1
    report["valvulas"]["diametros"]["12"] = 1
    report["canastillas"]["aduccion"]["10"] = 2
    report["canastillas"]["succion"]["8"] = 1
    report["canastillas"]["desague"]["14"] = 1

    html = render_report_html(report)

    valvulas_total_row = re.search(
        r'<td class="row-label">TOTAL</td>\s*'
        r'<td class="center" style="font-weight:bold;"></td>\s*'
        r'<td class="center" style="font-weight:bold;"></td>\s*'
        r'<td class="center" style="font-weight:bold;"></td>\s*'
        r'<td class="center" style="font-weight:bold;"></td>\s*'
        r'<td class="center" style="font-weight:bold;">1</td>\s*'
        r'<td class="center" style="font-weight:bold;">3</td>\s*'
        r'<td class="center" style="font-weight:bold;">1</td>',
        html,
    )
    assert valvulas_total_row is not None

    canastillas_total_row = re.search(
        r'Canastilla</th>[\s\S]*?'
        r'<td class="row-label">TOTAL</td>\s*'
        r'<td class="center" style="font-weight:bold;"></td>\s*'
        r'<td class="center" style="font-weight:bold;"></td>\s*'
        r'<td class="center" style="font-weight:bold;"></td>\s*'
        r'<td class="center" style="font-weight:bold;"></td>\s*'
        r'<td class="center" style="font-weight:bold;">1</td>\s*'
        r'<td class="center" style="font-weight:bold;">2</td>\s*'
        r'<td class="center" style="font-weight:bold;">1</td>',
        html,
    )
    assert canastillas_total_row is not None


def test_render_report_html_uses_custom_medida_labels() -> None:
    report = create_empty_report(9)
    report["medidas"]["etiqueta_diametro"] = "LARGO"
    report["medidas"]["etiqueta_diametro_interno"] = "ANCHO"
    report["medidas"]["diametro"] = "12"
    report["medidas"]["diametro_interno"] = "8"

    html = render_report_html(report)

    assert '<td class="row-label">LARGO</td>' in html
    assert '<td class="row-label">ANCHO</td>' in html
    assert '<td class="center">12</td>' in html
    assert '<td class="center">8</td>' in html
