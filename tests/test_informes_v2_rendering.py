import pathlib
import re

import pytest

from backend.core.informes_v2.models import create_empty_report
from backend.core.informes_v2.rendering import (
    render_consolidated_html,
    render_report_html,
    resolve_template_file,
)


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


def test_resolve_template_file() -> None:
    assert resolve_template_file("clasica") == "informe_v2.html"
    assert resolve_template_file("reservorios2") == "reservorios_2.html"
    assert resolve_template_file(None) == "informe_v2.html"
    assert resolve_template_file("  ") == "informe_v2.html"
    with pytest.raises(ValueError, match="Plantilla desconocida: 'otra'"):
        resolve_template_file("otra")


def _reservorios2_report():
    report = create_empty_report(7)
    report["plantilla"] = "reservorios2"
    report["header"]["estacion"] = "R 900"
    report["header"]["distrito"] = "San Juan de Miraflores"
    report["header"]["fecha_ejecucion"] = "10/09/2026"
    report["header"]["volumen"] = 900
    report["header"]["suministro"] = "SUM-900"
    report["reservorios2"]["inspeccion"]["ducto"] = {
        "normal": True,
        "critico": False,
        "observaciones": "desinfectado",
        "sugerencias": "",
    }
    report["reservorios2"]["inspeccion"]["cerco"] = {
        "normal": False,
        "critico": True,
        "observaciones": "",
        "sugerencias": "reiniciar cerco",
    }
    report["reservorios2"]["valvulas"]["desague"]["diametros"]["3"] = 2
    report["reservorios2"]["valvulas"]["desague"]["oper"] = 2
    report["reservorios2"]["valvulas"]["desague"]["observaciones"] = "válvula operativa"
    report["reservorios2"]["valvulas"]["desague"]["sugerencias"] = "mantener válvula"
    report["reservorios2"]["canastilla"]["succion"]["diametros"]["14"] = 1
    report["reservorios2"]["canastilla"]["succion"]["no_op"] = 1
    report["reservorios2"]["canastilla"]["succion"]["observaciones"] = "canastilla oxidada"
    report["reservorios2"]["canastilla"]["succion"]["sugerencias"] = "cambiar canastilla"
    report["reservorios2"]["medidas"]["altura_util"] = "2.10"
    report["reservorios2"]["medidas"]["etiqueta_altura_util"] = "PROFUNDIDAD UTIL"
    return report


def test_render_report_html_reservorios2_template() -> None:
    html = render_report_html(_reservorios2_report(), images=None)

    assert 'class="r2-info"' in html
    assert 'class="iv2-header r2-header"' in html
    assert "ESTRUCTURA" in html
    assert "R 900" in html
    assert "San Juan de Miraflores" in html
    assert "10/09/2026" in html
    assert "SUM-900" in html
    assert "900 m³" in html
    assert "DIÁMETRO DE VÁLVULAS" in html
    assert "DIÁMETRO DE CANASTILLA" in html
    assert "CANASTILLA" in html
    assert "NORMAL" in html
    assert "CRÍTICO" in html
    assert "SUGERENCIAS" in html
    assert "DIAMETRO INTERNO" in html
    assert "PROFUNDIDAD UTIL" in html
    assert "ALTURA UTIL" not in html
    assert '<td class="r2-ok">✓</td>' in html
    assert '<td class="r2-crit">X</td>' in html
    assert "reiniciar cerco" in html
    assert "válvula operativa" in html
    assert "mantener válvula" in html
    assert "canastilla oxidada" in html
    assert "cambiar canastilla" in html
    assert html.count('class="page"') == 1
    # el grupo ESCALERA/LOZA DE TECHO comparte celda de descripción
    assert html.count("ESCALERA") == 1
    assert html.count("LOZA DE TECHO") == 1
    assert html.count('<td class="r2-sub">INTERIOR</td>') == 3
    assert html.count('<td class="r2-sub">EXTERIOR</td>') == 3
    # secciones exclusivas de la plantilla clásica
    assert "DIAMETRO DE TUBERIA" not in html
    assert "LÍNEA" not in html
    assert "TIRANTE DE LIMPIEZA" not in html


def test_render_reservorios2_uses_global_oper_totals_without_row_attribution() -> None:
    report = create_empty_report(8)
    report["plantilla"] = "reservorios2"
    report["reservorios2"]["valvulas_totales"] = {"oper": 8, "no_op": 2}
    report["reservorios2"]["canastilla_totales"] = {"oper": 5, "no_op": 1}

    html = render_report_html(report)

    assert '<tr class="r2-total">' in html
    assert re.search(r'<tr class="r2-total">.*?<td>8</td>\s*<td>2</td>', html, re.DOTALL)
    assert re.search(r'<tr class="r2-total">.*?<td>5</td>\s*<td>1</td>', html, re.DOTALL)
    conduccion = re.search(r'<td class="r2-label">CONDUCCIÓN</td>(.*?)</tr>', html, re.DOTALL)
    aduccion = re.search(r'<td class="r2-label">ADUCCION</td>(.*?)</tr>', html, re.DOTALL)
    assert conduccion and "<td>8</td>" not in conduccion.group(1)
    assert aduccion and "<td>5</td>" not in aduccion.group(1)


def test_reservorios2_uses_technical_reports_jinja_contract() -> None:
    root = pathlib.Path(__file__).resolve().parent.parent
    template = (root / "backend" / "templates" / "informes_v2" / "reservorios_2.html").read_text(
        encoding="utf-8"
    )

    for field in (
        "report.header.cs",
        "report.header.ubicacion",
        "report.inspeccion",
        "report.valvulas",
        "report.canastillas",
        "report.medidas",
    ):
        assert field in template
    assert "report.reservorios2" not in template


def test_render_consolidated_groups_reports_by_plantilla() -> None:
    clasico = create_empty_report(1)
    clasico["header"]["estacion"] = "CLASICO"
    r2 = _reservorios2_report()
    html = render_consolidated_html([clasico, r2, create_empty_report(3)])

    assert html.count('class="page"') == 3
    assert "DIAMETRO DE VALVULAS" in html
    assert "DIÁMETRO DE VÁLVULAS" in html
    assert "San Juan de Miraflores" in html


def test_render_consolidated_preserves_order_across_plantillas() -> None:
    first = create_empty_report(1)
    first["header"]["estacion"] = "REPORT-1"
    middle = _reservorios2_report()
    middle["header"]["estacion"] = "REPORT-2"
    last = create_empty_report(3)
    last["header"]["estacion"] = "REPORT-3"

    html = render_consolidated_html([first, middle, last])

    assert html.index("REPORT-1") < html.index("REPORT-2") < html.index("REPORT-3")


def _css_rules(text: str) -> dict[str, dict[str, str]]:
    body = re.search(r"<style>(.*?)</style>", text, re.DOTALL)
    assert body, "el documento no tiene bloque <style>"
    source = re.sub(r"/\*.*?\*/", "", body.group(1), flags=re.DOTALL)
    rules: dict[str, dict[str, str]] = {}
    for selector, declarations in re.findall(r"([^{}]+)\{([^{}]*)\}", source):
        props: dict[str, str] = {}
        for decl in declarations.split(";"):
            if ":" in decl:
                key, value = decl.split(":", 1)
                props[" ".join(key.split())] = " ".join(value.split())
        rules[" ".join(selector.split())] = props
    return rules


def test_reservorios2_template_css_is_mirrored_in_the_preview() -> None:
    root = pathlib.Path(__file__).resolve().parent.parent
    template = (root / "backend" / "templates" / "informes_v2" / "reservorios_2.html").read_text(encoding="utf-8")
    preview = (
        root / "frontend" / "src" / "components" / "informes-v2" / "informes-v2.css"
    ).read_text(encoding="utf-8")

    template_rules = _css_rules(template)
    # un comentario cerrado de mas temprano se traga la regla siguiente en Chromium
    assert not [sel for sel in template_rules if "*/" in sel]

    preview_rules = _css_rules(f"<style>{preview}</style>")
    mirrored = {sel: props for sel, props in template_rules.items() if ".r2-" in sel}
    assert mirrored
    for selector, props in mirrored.items():
        assert selector in preview_rules, f"{selector} falta en informes-v2.css"
        for prop, value in props.items():
            assert preview_rules[selector].get(prop) == value, (
                f"{selector} {{{prop}}} difiere: preview={preview_rules[selector].get(prop)!r} "
                f"plantilla={value!r}"
            )

    assert template_rules[".iv2-photo-cell.r2-photo-cell img"]["object-fit"] == "fill"


def test_shared_selectors_between_plantillas_no_se_pisan() -> None:
    templates = pathlib.Path(__file__).resolve().parent.parent / "backend" / "templates" / "informes_v2"
    clasica = _css_rules((templates / "informe_v2.html").read_text(encoding="utf-8"))
    r2 = _css_rules((templates / "reservorios_2.html").read_text(encoding="utf-8"))
    # el export consolidado concatena los documentos: dos reglas iguales sobre el mismo
    # selector se resuelven por orden, no por plantilla
    for selector in sorted(set(clasica) & set(r2)):
        for prop in sorted(set(clasica[selector]) & set(r2[selector])):
            assert clasica[selector][prop] == r2[selector][prop], (
                f"{selector} {{{prop}}}: clásica={clasica[selector][prop]!r} "
                f"reservorios2={r2[selector][prop]!r}"
            )
