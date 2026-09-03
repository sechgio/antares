from __future__ import annotations

from pathlib import Path
from typing import Any

from backend.handlers.common import validate_params, with_locale
from backend.utils.paths import resource_path, user_data_path


def _preview_template_dirs() -> list[Path]:
    bundled = [
        resource_path("backend/templates"),
        resource_path("templates"),
        Path(__file__).resolve().parent.parent / "templates",
    ]
    candidates: list[Path] = []
    user_dir = user_data_path("templates")
    try:
        if user_dir.is_dir() and any(user_dir.glob("*.html")):
            candidates.append(user_dir)
    except OSError:
        pass
    candidates.extend(bundled)

    existing: list[Path] = []
    seen: set[Path] = set()
    for cand in candidates:
        try:
            resolved = cand.resolve()
            if resolved.exists() and resolved.is_dir() and resolved not in seen:
                seen.add(resolved)
                existing.append(resolved)
        except OSError:
            continue
    return existing


@with_locale
def templates_list(params: dict[str, Any]) -> dict[str, list[dict[str, str]]]:
    dirs = _preview_template_dirs()
    seen_names: set[str] = set()
    templates: list[dict[str, str]] = []
    for templates_dir in dirs:
        for f in sorted(templates_dir.glob("*.html")):
            if f.name not in seen_names and f.is_file():
                seen_names.add(f.name)
                templates.append(
                    {
                        "id": f.stem,
                        "name": f.name,
                        "filename": f.name,
                        "source": "html",
                    }
                )
    templates.sort(key=lambda t: t["name"].lower())
    return {"templates": templates}


@with_locale
@validate_params("name")
def template_get(params: dict[str, Any]) -> dict[str, Any]:
    name = params.get("name", "")
    dirs = _preview_template_dirs()
    target_file: Path | None = None
    for templates_dir in dirs:
        target = templates_dir / name
        try:
            target.relative_to(templates_dir.resolve())
            if target.exists() and target.is_file():
                target_file = target
                break
        except (ValueError, OSError):
            continue

    if target_file is None:
        msg = f"Template not found: {name}"
        raise ValueError(msg)
    return {"name": name, "source": "html", "content": target_file.read_text(encoding="utf-8")}


HANDLERS = {
    "templates_list": templates_list,
    "template_get": template_get,
}

