
from __future__ import annotations

from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from backend.core.fichas_tecnicas.models import FichaTecnica, template_placeholder_ficha
from backend.utils.paths import resource_path

_jinja_env: Environment | None = None
_jinja_template_mtime: float = 0.0


def _templates_dir() -> Path:
    bundled = resource_path("backend/templates/fichas_tecnicas")
    if bundled.exists():
        return bundled
    return Path(__file__).resolve().parents[2] / "templates" / "fichas_tecnicas"


def _format_cantidad(value: Any) -> str:
    if value is None or value == "":
        return ""
    try:
        return f"{float(value):.4f}"
    except (TypeError, ValueError):
        return str(value)


def _format_fecha_display(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    date_part = text.split(" ")[0]
    parts = date_part.split("-")
    if len(parts) == 3 and len(parts[0]) == 4:
        return f"{parts[2]}-{parts[1]}-{parts[0]}"
    return text


def _format_os_display(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return "00000"
    if text.upper().startswith("OS-"):
        text = text[3:]
    return text.replace("-", "")


def _environment() -> Environment:
    global _jinja_env, _jinja_template_mtime
    templates_dir = _templates_dir()
    template_file = templates_dir / "ficha_tecnica.html"
    template_mtime = template_file.stat().st_mtime if template_file.exists() else 0.0
    if _jinja_env is None or template_mtime != _jinja_template_mtime:
        _jinja_env = Environment(
            loader=FileSystemLoader(str(templates_dir)),
            autoescape=select_autoescape(("html", "xml")),
            auto_reload=True,
        )
        _jinja_env.filters["format_cantidad"] = _format_cantidad
        _jinja_env.filters["format_fecha_display"] = _format_fecha_display
        _jinja_env.filters["format_os_display"] = _format_os_display
        _jinja_template_mtime = template_mtime
    return _jinja_env


def render_ficha_html(
    ficha: dict[str, Any],
    logo_left: str | None = None,
    logo_right: str | None = None,
) -> str:
    template = _environment().get_template("ficha_tecnica.html")
    return template.render(
        fichas=[FichaTecnica.normalize(ficha)],
        logo_left=logo_left,
        logo_right=logo_right,
    )


def render_template_html(logo_left: str | None = None, logo_right: str | None = None) -> str:
    return render_ficha_html(template_placeholder_ficha(), logo_left, logo_right)


def render_consolidated_html(
    fichas: list[dict[str, Any]],
    logo_left: str | None = None,
    logo_right: str | None = None,
) -> str:
    if not fichas:
        msg = "No hay fichas para exportar"
        raise ValueError(msg)
    template = _environment().get_template("ficha_tecnica.html")
    return template.render(
        fichas=[FichaTecnica.normalize(f) for f in fichas],
        logo_left=logo_left,
        logo_right=logo_right,
    )
