from __future__ import annotations

from typing import Any

from backend.handlers.common import (
    clear_store,
    delete_item_or_raise,
    get_item_id,
    get_item_or_raise,
    get_items_by_optional_ids,
    import_into_store,
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

    cliente = str(params.get("cliente") or "").strip().lower()
    distrito = str(params.get("distrito") or "").strip().lower()
    status = str(params.get("status") or "").strip()

    def matches(ficha: dict[str, Any]) -> bool:  # allowlist: dict[str, Any]
        return (
            (not cliente or cliente in str(ficha.get("cliente", "")).lower())
            and (not distrito or distrito in str(ficha.get("distrito", "")).lower())
            and (not status or ficha.get("status") == status)
        )

    store = _db()
    if params.get("summary"):
        fichas = store.project_all(FichaTecnica.summary, matches)
    else:
        fichas = [ficha for ficha in store.get_all() if matches(ficha)]
    fichas.sort(key=lambda f: str(f.get("id", "")))
    return {"items": fichas, "total": len(fichas)}


@with_locale
def fichas_tecnicas_get(params: dict[str, Any]) -> dict[str, Any]:
    ficha_id = get_item_id(params)
    return {"item": get_item_or_raise(_db(), ficha_id, "Ficha no encontrada")}


@with_locale
def fichas_tecnicas_create(params: dict[str, Any]) -> dict[str, Any]:
    ficha = params.get("ficha")
    created = _db().create(ficha if isinstance(ficha, dict) else None)
    return {"success": True, "item": created}


@with_locale
def fichas_tecnicas_update(params: dict[str, Any]) -> dict[str, Any]:
    ficha_id, ficha = require_update_payload(params, "ficha")
    return {"success": True, "item": update_item_or_raise(_db(), ficha_id, ficha)}


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

    return import_into_store(_db(), params, import_fichas_from_bytes, "fichas importadas")


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

    fichas = get_items_by_optional_ids(
        _db(), params.get("ficha_ids"), "No hay fichas para exportar"
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
