"""Fichas Técnicas IPC handlers."""

from __future__ import annotations

import base64
from typing import Any

from backend.handlers.common import with_locale


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
    ficha_id = str(params.get("id") or "")
    ficha = _db().get(ficha_id)
    if ficha is None:
        msg = f"Ficha no encontrada: {ficha_id}"
        raise ValueError(msg)
    return {"ficha": ficha}


@with_locale
def fichas_tecnicas_create(params: dict[str, Any]) -> dict[str, Any]:
    ficha = params.get("ficha")
    created = _db().create(ficha if isinstance(ficha, dict) else None)
    return {"success": True, "ficha": created}


@with_locale
def fichas_tecnicas_update(params: dict[str, Any]) -> dict[str, Any]:
    ficha_id = str(params.get("id") or "")
    ficha = params.get("ficha")
    if not ficha_id or not isinstance(ficha, dict):
        msg = "id y ficha son requeridos"
        raise ValueError(msg)
    try:
        updated = _db().update(ficha_id, ficha)
    except KeyError as exc:
        raise ValueError(str(exc)) from exc
    return {"success": True, "ficha": updated}


@with_locale
def fichas_tecnicas_delete(params: dict[str, Any]) -> dict[str, Any]:
    ficha_id = str(params.get("id") or "")
    if not _db().delete(ficha_id):
        msg = f"Ficha no encontrada: {ficha_id}"
        raise ValueError(msg)
    return {"success": True, "deleted_id": ficha_id}


@with_locale
def fichas_tecnicas_clear(params: dict[str, Any]) -> dict[str, Any]:
    count = _db().clear_all()
    return {"success": True, "deleted_count": count, "message": f"Se eliminaron {count} fichas"}


@with_locale
def fichas_tecnicas_import_file(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.fichas_tecnicas.importer import import_fichas_from_bytes

    filename = str(params.get("filename") or "")
    content_b64 = str(params.get("content_b64") or "")
    if not filename or not content_b64:
        msg = "filename y content_b64 son requeridos"
        raise ValueError(msg)
    content = base64.b64decode(content_b64)
    imported_rows = import_fichas_from_bytes(filename, content)
    db = _db()
    deleted_count = len(db.get_all())
    imported = db.replace_all(imported_rows)
    return {
        "success": True,
        "message": f"{len(imported)} fichas importadas",
        "deleted_count": deleted_count,
        "imported_count": len(imported),
        "total_rows_in_file": len(imported_rows),
    }


@with_locale
def fichas_tecnicas_autocomplete_cliente(params: dict[str, Any]) -> dict[str, Any]:
    return {"options": _db().get_unique_clientes()}


@with_locale
def fichas_tecnicas_autocomplete_distrito(params: dict[str, Any]) -> dict[str, Any]:
    return {"options": _db().get_unique_distritos()}


def _resolve_ficha_for_render(params: dict[str, Any]) -> dict[str, Any]:
    ficha_payload = params.get("ficha")
    ficha_id = str(params.get("id") or "").strip()

    if isinstance(ficha_payload, dict) and ficha_payload:
        return ficha_payload

    if ficha_id:
        stored = _db().get(ficha_id)
        if isinstance(stored, dict):
            return stored

    msg = "Ficha no encontrada: envíe la ficha actual o un id válido"
    raise ValueError(msg)


@with_locale
def fichas_tecnicas_render_html(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.fichas_tecnicas.rendering import render_ficha_html, render_template_html

    if params.get("template"):
        html = render_template_html(params.get("logo_left"), params.get("logo_right"))
        return {"html": html, "filename": "plantilla_ficha_tecnica.pdf"}

    ficha = _resolve_ficha_for_render(params)
    html = render_ficha_html(ficha, params.get("logo_left"), params.get("logo_right"))
    return {"html": html, "filename": f"ficha_tecnica_{ficha.get('id') or 'inline'}.pdf"}


@with_locale
def fichas_tecnicas_render_consolidated_html(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.fichas_tecnicas.rendering import render_consolidated_html

    fichas = _db().get_all()
    ficha_ids = params.get("ficha_ids")
    if isinstance(ficha_ids, list) and ficha_ids:
        allowed = {str(fid) for fid in ficha_ids}
        fichas = [f for f in fichas if f["id"] in allowed]
    if not fichas:
        msg = "No hay fichas para exportar"
        raise ValueError(msg)
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
    "fichas_tecnicas_autocomplete_cliente": fichas_tecnicas_autocomplete_cliente,
    "fichas_tecnicas_autocomplete_distrito": fichas_tecnicas_autocomplete_distrito,
    "fichas_tecnicas_render_html": fichas_tecnicas_render_html,
    "fichas_tecnicas_render_consolidated_html": fichas_tecnicas_render_consolidated_html,
}
