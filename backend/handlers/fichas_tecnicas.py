from __future__ import annotations

from typing import Any

from backend.handlers.common import (
    clear_store,
    delete_item_or_raise,
    filter_by_optional_ids,
    get_item_id,
    get_item_or_raise,
    require_b64_file_payload,
    require_update_payload,
    resolve_payload_or_store,
    update_item_or_raise,
    with_locale,
)


def _db():
    from backend.core.fichas_tecnicas.database import get_fichas_db

    return get_fichas_db()


@with_locale
def fichas_tecnicas_list(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.fichas_tecnicas.models import FichaTecnica

    fichas = _db().get_all()
    cliente = str(params.get("cliente") or "").strip().lower()
    distrito = str(params.get("distrito") or "").strip().lower()
    status = str(params.get("status") or "").strip()
    if cliente:
        fichas = [f for f in fichas if cliente in str(f.get("cliente", "")).lower()]
    if distrito:
        fichas = [f for f in fichas if distrito in str(f.get("distrito", "")).lower()]
    if status:
        fichas = [f for f in fichas if f.get("status") == status]
    fichas.sort(key=lambda f: str(f.get("id", "")))
    if params.get("summary"):
        fichas = [FichaTecnica.summary(f) for f in fichas]
    return {"fichas": fichas, "total": len(fichas)}


@with_locale
def fichas_tecnicas_get(params: dict[str, Any]) -> dict[str, Any]:
    ficha_id = get_item_id(params)
    return {"ficha": get_item_or_raise(_db(), ficha_id, "Ficha no encontrada")}


@with_locale
def fichas_tecnicas_create(params: dict[str, Any]) -> dict[str, Any]:
    ficha = params.get("ficha")
    created = _db().create(ficha if isinstance(ficha, dict) else None)
    return {"success": True, "ficha": created}


@with_locale
def fichas_tecnicas_update(params: dict[str, Any]) -> dict[str, Any]:
    ficha_id, ficha = require_update_payload(params, "ficha")
    return {"success": True, "ficha": update_item_or_raise(_db(), ficha_id, ficha)}


@with_locale
def fichas_tecnicas_delete(params: dict[str, Any]) -> dict[str, Any]:
    ficha_id = get_item_id(params)
    delete_item_or_raise(_db(), ficha_id, "Ficha no encontrada")
    return {"success": True, "deleted_id": ficha_id}


@with_locale
def fichas_tecnicas_clear(params: dict[str, Any]) -> dict[str, Any]:
    return clear_store(_db(), "fichas")


@with_locale
def fichas_tecnicas_import_file(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.fichas_tecnicas.importer import import_fichas_from_bytes

    filename, content = require_b64_file_payload(params)
    imported_rows = import_fichas_from_bytes(filename, content)
    imported, deleted_count = _db().replace_all_counted(imported_rows)
    return {
        "success": True,
        "message": f"{len(imported)} fichas importadas",
        "deleted_count": deleted_count,
        "imported_count": len(imported),
        "total_rows_in_file": len(imported_rows),
    }


@with_locale
def fichas_tecnicas_render_html(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.fichas_tecnicas.rendering import render_ficha_html, render_template_html

    if params.get("template"):
        html = render_template_html(params.get("logo_left"), params.get("logo_right"))
        return {"html": html, "filename": "plantilla_ficha_tecnica.pdf"}

    ficha = resolve_payload_or_store(
        _db(), params, "ficha", "Ficha no encontrada: envíe la ficha actual o un id válido"
    )
    html = render_ficha_html(ficha, params.get("logo_left"), params.get("logo_right"))
    return {"html": html, "filename": f"ficha_tecnica_{ficha.get('id') or 'inline'}.pdf"}


@with_locale
def fichas_tecnicas_render_consolidated_html(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.fichas_tecnicas.rendering import render_consolidated_html

    fichas = filter_by_optional_ids(
        _db().get_all(), params.get("ficha_ids"), "No hay fichas para exportar"
    )
    fichas.sort(key=lambda f: str(f.get("id", "")))
    html = render_consolidated_html(fichas, params.get("logo_left"), params.get("logo_right"))
    return {
        "html": html,
        "filename": f"fichas_tecnicas_consolidado_{len(fichas)}.pdf",
        "count": len(fichas),
    }


HANDLERS = {
    "fichas_tecnicas_list": fichas_tecnicas_list,
    "fichas_tecnicas_get": fichas_tecnicas_get,
    "fichas_tecnicas_create": fichas_tecnicas_create,
    "fichas_tecnicas_update": fichas_tecnicas_update,
    "fichas_tecnicas_delete": fichas_tecnicas_delete,
    "fichas_tecnicas_clear": fichas_tecnicas_clear,
    "fichas_tecnicas_import_file": fichas_tecnicas_import_file,
    "fichas_tecnicas_render_html": fichas_tecnicas_render_html,
    "fichas_tecnicas_render_consolidated_html": fichas_tecnicas_render_consolidated_html,
}
