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


def test_render_report_html_preserves_red_critical_checks() -> None:
    report = create_empty_report(5)
    report["inspeccion"]["descarga"] = "critico"

    html = render_report_html(report)

    assert re.search(r'<span\s+class="check-critico">\s*X\s*</span>', html)


def test_render_consolidated_html_renders_multiple_pages() -> None:
    reports = [create_empty_report(1), create_empty_report(2)]

    html = render_consolidated_html(reports)

    assert len(re.findall(r'<div class="page-container">', html)) == 2
