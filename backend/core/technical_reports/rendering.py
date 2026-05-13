from __future__ import annotations

from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from backend.core.technical_reports.models import TechnicalReport
from backend.utils.paths import resource_path


def _templates_dir() -> Path:
    bundled = resource_path("backend/templates/technical_reports")
    if bundled.exists():
        return bundled
    return Path(__file__).resolve().parents[2] / "templates" / "technical_reports"


# Module-level singleton — avoids recreating Environment + losing template cache on each render.
_jinja_env: Environment | None = None


def _environment() -> Environment:
    global _jinja_env
    if _jinja_env is None:
        _jinja_env = Environment(
            loader=FileSystemLoader(str(_templates_dir())),
            autoescape=select_autoescape(("html", "xml")),
        )
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
