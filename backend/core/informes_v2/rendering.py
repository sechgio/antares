from __future__ import annotations

from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from backend.core.informes_v2.models import (
    DIAMETERS,
    LINEA_ROWS,
    VALVULA_ROWS,
    InformeV2,
    sum_diameter_columns,
    sum_oper_no_op,
)
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


def _templates_dir() -> Path:
    bundled = resource_path("backend/templates/informes_v2")
    if bundled.exists():
        return bundled
    return Path(__file__).resolve().parents[2] / "templates" / "informes_v2"


_jinja_env: Environment | None = None
_jinja_template_mtime: float = 0.0


def _environment() -> Environment:
    global _jinja_env, _jinja_template_mtime
    templates_dir = _templates_dir()
    template_file = templates_dir / "informe_v2.html"
    template_mtime = template_file.stat().st_mtime if template_file.exists() else 0.0
    if _jinja_env is None or template_mtime != _jinja_template_mtime:
        _jinja_env = Environment(
            loader=FileSystemLoader(str(templates_dir)),
            autoescape=select_autoescape(("html", "xml")),
            auto_reload=True,
        )
        _jinja_env.globals["sum_diameter_columns"] = sum_diameter_columns
        _jinja_env.globals["sum_oper_no_op"] = sum_oper_no_op
        _jinja_env.globals["DIAMETERS"] = DIAMETERS
        _jinja_env.globals["VALVULA_ROWS"] = VALVULA_ROWS
        _jinja_env.globals["LINEA_ROWS"] = LINEA_ROWS
        _jinja_env.globals["VALVULA_LABELS"] = VALVULA_LABELS
        _jinja_env.globals["LINEA_LABELS"] = LINEA_LABELS
        _jinja_template_mtime = template_mtime
    return _jinja_env


def _prepare_report(report: dict[str, Any], images: list[dict[str, str]] | None = None) -> dict[str, Any]:
    normalized = InformeV2.normalize(report)
    photos = images if isinstance(images, list) else []
    # Cap at 6; pad with empty slots for fixed 3x2 grid
    slots: list[dict[str, str] | None] = []
    for img in photos[:6]:
        if isinstance(img, dict) and (img.get("path") or img.get("src")):
            slots.append({"path": str(img.get("path") or img.get("src")), "name": str(img.get("name") or "")})
        elif isinstance(img, str) and img:
            slots.append({"path": img, "name": ""})
    while len(slots) < 6:
        slots.append(None)
    normalized["_photos"] = slots
    return normalized


def render_report_html(
    report: dict[str, Any],
    logo_left: str | None = None,
    logo_right: str | None = None,
    images: list[dict[str, str]] | None = None,
) -> str:
    template = _environment().get_template("informe_v2.html")
    return template.render(
        reports=[_prepare_report(report, images)],
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
    prepared = []
    for report in reports:
        rid = str(report.get("id") or "")
        prepared.append(_prepare_report(report, images_by_id.get(rid)))
    template = _environment().get_template("informe_v2.html")
    return template.render(reports=prepared, logo_left=logo_left, logo_right=logo_right)
