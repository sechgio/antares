"""HTML template handlers."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from backend.handlers.common import validate_params, with_locale
from backend.utils.paths import resource_path


def _preview_templates_dir() -> Path:
    bundled = resource_path("backend/templates")
    if bundled.exists():
        return bundled
    return Path(__file__).resolve().parent.parent / "templates"

@with_locale
def templates_list(params: dict[str, Any]) -> dict[str, list[dict[str, str]]]:
    templates_dir = _preview_templates_dir()
    if not templates_dir.exists():
        return {"templates": []}
    return {"templates": [{"id": f.stem, "name": f.name, "filename": f.name} for f in sorted(templates_dir.glob("*.html"))]}

@with_locale
@validate_params("name")
def template_get(params: dict[str, Any]) -> dict[str, str]:
    name = params.get("name", "")
    templates_dir = _preview_templates_dir()
    target = templates_dir / name
    try:
        target.relative_to(templates_dir.resolve())
    except ValueError as err:
        msg = "Invalid template name"
        raise ValueError(msg) from err
    if not target.exists() or not target.is_file():
        msg = f"Template not found: {name}"
        raise ValueError(msg)
    return {"name": name, "content": target.read_text(encoding="utf-8")}

HANDLERS = {
    "templates_list": templates_list,
    "template_get": template_get,
}
