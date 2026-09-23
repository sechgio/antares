from __future__ import annotations

from pathlib import Path
from typing import Any

from backend.core.informes_v2.models import (
    DEFAULT_PLANTILLA,
    DIAMETERS,
    LINEA_ROWS,
    R2_CANASTILLA_DIAMETERS,
    R2_CANASTILLA_LABELS,
    R2_CANASTILLA_ROWS,
    R2_INSPECCION_ITEMS,
    R2_TITULO_LINEA1,
    R2_TITULO_LINEA2,
    R2_VALVULA_DIAMETERS,
    R2_VALVULA_LABELS,
    R2_VALVULA_ROWS,
    VALVULA_ROWS,
    InformeV2,
    sum_diameter_columns,
    sum_oper_no_op,
)
from backend.core.jinja_environment import make_cached_jinja_environment
from backend.core.technical_reports.models import INSPECTION_TEXT_FIELDS
from backend.utils.paths import resource_path

VALVULA_LABELS = {
    "conduccion": "CONDUCCION",
    "impulsion": "IMPULSION",
    "aduccion": "ADUCCION",
    "bypass": "BY PASS",
    "purga": "PURGA",
}

LINEA_LABELS = {
    "aduccion": "ADUCCION",
    "alimentacion": "ALIMENTACION",
    "impulsion_rebombeo": "IMPULSION (REBOMBEO)",
    "rebose": "REBOSE",
    "purga": "PURGA",
}

PLANTILLA_TEMPLATE_FILES: dict[str, str] = {
    "clasica": "informe_v2.html",
    "reservorios2": "reservorios_2.html",
}
DEFAULT_PLANTILLA_ID = DEFAULT_PLANTILLA

_R2_TECHNICAL_INSPECTION_KEYS = {
    "ducto": "ducto_ventilacion",
    "cerco": "cerco_perimetrico",
}


def resolve_template_file(plantilla: str | None) -> str:
    key = (plantilla or "").strip() or DEFAULT_PLANTILLA_ID
    filename = PLANTILLA_TEMPLATE_FILES.get(key)
    if filename is None:
        known = ", ".join(sorted(PLANTILLA_TEMPLATE_FILES))
        msg = f"Plantilla desconocida: {key!r}. Opciones: {known}"
        raise ValueError(msg)
    return filename


def _templates_dir() -> Path:
    bundled = resource_path("backend/templates/informes_v2")
    if bundled.exists():
        return bundled
    return Path(__file__).resolve().parents[2] / "templates" / "informes_v2"


_environment = make_cached_jinja_environment(
    _templates_dir,
    PLANTILLA_TEMPLATE_FILES[DEFAULT_PLANTILLA_ID],
    global_values={
        "sum_diameter_columns": sum_diameter_columns,
        "sum_oper_no_op": sum_oper_no_op,
        "DIAMETERS": DIAMETERS,
        "VALVULA_ROWS": VALVULA_ROWS,
        "LINEA_ROWS": LINEA_ROWS,
        "VALVULA_LABELS": VALVULA_LABELS,
        "LINEA_LABELS": LINEA_LABELS,
        "R2_VALVULA_ROWS": R2_VALVULA_ROWS,
        "R2_VALVULA_DIAMETERS": R2_VALVULA_DIAMETERS,
        "R2_VALVULA_LABELS": R2_VALVULA_LABELS,
        "R2_CANASTILLA_ROWS": R2_CANASTILLA_ROWS,
        "R2_CANASTILLA_DIAMETERS": R2_CANASTILLA_DIAMETERS,
        "R2_CANASTILLA_LABELS": R2_CANASTILLA_LABELS,
        "R2_INSPECCION_ITEMS": [
            {
                "key": _R2_TECHNICAL_INSPECTION_KEYS.get(key, key),
                "label": label,
                "sub": sub,
                "obs_key": INSPECTION_TEXT_FIELDS[_R2_TECHNICAL_INSPECTION_KEYS.get(key, key)][0],
                "sug_key": INSPECTION_TEXT_FIELDS[_R2_TECHNICAL_INSPECTION_KEYS.get(key, key)][1],
            }
            for key, label, sub in R2_INSPECCION_ITEMS
        ],
    },
)


def _prepare_reservorios2_jinja_report(report: dict[str, Any]) -> dict[str, Any]:  # allowlist: template-specific report payload
    r2 = report["reservorios2"]
    inspection: dict[str, Any] = {}  # allowlist: template keys vary by inspection section
    for source_key, _, _ in R2_INSPECCION_ITEMS:
        target_key = _R2_TECHNICAL_INSPECTION_KEYS.get(source_key, source_key)
        row = r2["inspeccion"][source_key]
        inspection[target_key] = "normal" if row["normal"] else "critico" if row["critico"] else "unchecked"
        obs_key, sug_key = INSPECTION_TEXT_FIELDS[target_key]
        inspection[obs_key] = row["observaciones"]
        inspection[sug_key] = row["sugerencias"]

    valves = r2["valvulas"]
    canastillas = r2["canastilla"]
    valves_sum = sum_oper_no_op(valves, R2_VALVULA_ROWS)
    canastillas_sum = sum_oper_no_op(canastillas, R2_CANASTILLA_ROWS)
    valves_totals = r2["valvulas_totales"]
    canastillas_totals = r2["canastilla_totales"]
    valves_context: dict[str, Any] = {  # allowlist: template-specific field names
        "diametros": valves["conduccion"]["diametros"],
        **{key: valves[key]["diametros"] for key in R2_VALVULA_ROWS if key != "conduccion"},
        "operativas": valves_totals["oper"] if valves_totals["oper"] is not None else valves_sum[0],
        "no_operativas": valves_totals["no_op"] if valves_totals["no_op"] is not None else valves_sum[1],
        "oper_por_fila": {key: row["oper"] for key, row in valves.items()},
        "no_op_por_fila": {key: row["no_op"] for key, row in valves.items()},
        "totales": sum_diameter_columns(valves, R2_VALVULA_ROWS, R2_VALVULA_DIAMETERS),
    }
    canastillas_context: dict[str, Any] = {  # allowlist: template-specific field names
        **{key: row["diametros"] for key, row in canastillas.items()},
        "operativas": (
            canastillas_totals["oper"] if canastillas_totals["oper"] is not None else canastillas_sum[0]
        ),
        "no_operativas": (
            canastillas_totals["no_op"] if canastillas_totals["no_op"] is not None else canastillas_sum[1]
        ),
        "oper_por_fila": {key: row["oper"] for key, row in canastillas.items()},
        "no_op_por_fila": {key: row["no_op"] for key, row in canastillas.items()},
        "totales": sum_diameter_columns(canastillas, R2_CANASTILLA_ROWS, R2_CANASTILLA_DIAMETERS),
    }
    for key, row in valves.items():
        valves_context[f"observaciones_{key}"] = row["observaciones"]
        valves_context[f"sugerencias_{key}"] = row["sugerencias"]
    for key, row in canastillas.items():
        canastillas_context[f"observaciones_{key}"] = row["observaciones"]
        canastillas_context[f"sugerencias_{key}"] = row["sugerencias"]

    return {
        "id": report["id"],
        "metadata": report["metadata"],
        "plantilla": report["plantilla"],
        "header": {
            "cs": report["header"]["estacion"],
            "ubicacion": report["header"]["distrito"],
            "tipo": report["header"]["tipo"],
            "volumen": report["header"]["volumen"],
            "suministro": report["header"]["suministro"],
            "fecha_ejecucion": report["header"]["fecha_ejecucion"],
            "titulo_linea1": R2_TITULO_LINEA1,
            "titulo_linea2": R2_TITULO_LINEA2,
        },
        "inspeccion": inspection,
        "valvulas": valves_context,
        "canastillas": canastillas_context,
        "medidas": r2["medidas"],
        "_photos": report["_photos"],
    }


def _prepare_report(report: dict[str, Any], images: list[dict[str, str]] | None = None) -> dict[str, Any]:
    normalized = InformeV2.normalize(report)
    photos = images if isinstance(images, list) else []
    slots: list[dict[str, str] | None] = []
    for img in photos[:6]:
        if isinstance(img, dict) and (img.get("path") or img.get("src")):
            slots.append({"path": str(img.get("path") or img.get("src")), "name": str(img.get("name") or "")})
        elif isinstance(img, str) and img:
            slots.append({"path": img, "name": ""})
    while len(slots) < 6:
        slots.append(None)
    normalized["_photos"] = slots
    if normalized["plantilla"] == "reservorios2":
        return _prepare_reservorios2_jinja_report(normalized)
    return normalized


def render_report_html(
    report: dict[str, Any],
    logo_left: str | None = None,
    logo_right: str | None = None,
    images: list[dict[str, str]] | None = None,
) -> str:
    prepared = _prepare_report(report, images)
    template = _environment().get_template(resolve_template_file(prepared.get("plantilla")))
    return template.render(
        reports=[prepared],
        logo_left=logo_left,
        logo_right=logo_right,
    )


def render_consolidated_html(
    reports: list[dict[str, Any]],
    logo_left: str | None = None,
    logo_right: str | None = None,
    images_by_id: dict[str, list[dict[str, str]]] | None = None,
) -> str:
    if not reports:
        msg = "No hay informes para exportar"
        raise ValueError(msg)
    images_by_id = images_by_id if isinstance(images_by_id, dict) else {}
    groups: list[tuple[str, list[dict[str, Any]]]] = []  # allowlist: mixed template report payloads
    for report in reports:
        prepared = _prepare_report(report, images_by_id.get(str(report.get("id") or "")))
        template_file = resolve_template_file(prepared.get("plantilla"))
        if groups and groups[-1][0] == template_file:
            groups[-1][1].append(prepared)
        else:
            groups.append((template_file, [prepared]))

    environment = _environment()
    rendered: list[str] = []
    for template_file, group in groups:
        template = environment.get_template(template_file)
        rendered.append(
            template.render(reports=group, logo_left=logo_left, logo_right=logo_right)
        )
    return "".join(rendered)
