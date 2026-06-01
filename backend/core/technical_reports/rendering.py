from __future__ import annotations

from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from backend.core.technical_reports.diameter_totals import sum_diameter_columns
from backend.core.technical_reports.models import TechnicalReport
from backend.utils.paths import resource_path


def _templates_dir() -> Path:
    bundled = resource_path("backend/templates/technical_reports")
    if bundled.exists():
        return bundled
    return Path(__file__).resolve().parents[2] / "templates" / "technical_reports"


# Module-level singleton — avoids recreating Environment + losing template cache on each render.
_jinja_env: Environment | None = None
_jinja_template_mtime: float = 0.0


def _environment() -> Environment:
    global _jinja_env, _jinja_template_mtime
    templates_dir = _templates_dir()
    template_file = templates_dir / "informe_tecnico.html"
    template_mtime = template_file.stat().st_mtime if template_file.exists() else 0.0
    if _jinja_env is None or template_mtime != _jinja_template_mtime:
        _jinja_env = Environment(
            loader=FileSystemLoader(str(templates_dir)),
            autoescape=select_autoescape(("html", "xml")),
            auto_reload=True,
        )
        _jinja_env.globals["sum_diameter_columns"] = sum_diameter_columns
        _jinja_template_mtime = template_mtime
    return _jinja_env


def render_report_html(report: dict[str, Any], logo_left: str | None = None, logo_right: str | None = None) -> str:
    template = _environment().get_template("informe_tecnico.html")
    return template.render(reports=[TechnicalReport.normalize(report)], logo_left=logo_left, logo_right=logo_right)


def render_consolidated_html(
    reports: list[dict[str, Any]],
    logo_left: str | None = None,
    logo_right: str | None = None,
) -> str:
    if not reports:
        msg = "No hay informes para exportar"
        raise ValueError(msg)
    template = _environment().get_template("informe_tecnico.html")
    return template.render(
        reports=[TechnicalReport.normalize(report) for report in reports],
        logo_left=logo_left,
        logo_right=logo_right,
    )
