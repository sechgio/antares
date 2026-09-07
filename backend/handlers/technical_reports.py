from __future__ import annotations

from typing import Any

from backend.handlers.common import (
    clear_store,
    create_report_from_params,
    delete_item_or_raise,
    get_item_id,
    get_item_or_raise,
    require_update_payload,
    update_item_or_raise,
    with_locale,
)
from backend.utils.image_data import decode_b64_payload


def _db():
    from backend.core.technical_reports.database import get_reports_db
    return get_reports_db()


def _summary(report: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": report["id"],
        "metadata": {"informe_id": report["metadata"].get("informe_id", 0)},
        "header": {"cs": report["header"].get("cs", ""), "codigo_infraestructura": report["header"].get("codigo_infraestructura", "")},
        "status": report.get("status", "draft"),
    }

@with_locale
def technical_reports_list(params: dict[str, Any]) -> dict[str, Any]:
    reports = _db().get_all()
    cs = str(params.get("cs") or "").strip()
    contratista = str(params.get("contratista") or "").strip()
    status = str(params.get("status") or "").strip()
    if cs:
        reports = [r for r in reports if r["header"].get("cs") == cs]
    if contratista:
        reports = [r for r in reports if r["header"].get("contratista") == contratista]
    if status:
        reports = [r for r in reports if r.get("status") == status]
    reports.sort(key=lambda r: int(r["metadata"].get("informe_id", 0)))
    if params.get("summary"):
        reports = [_summary(r) for r in reports]
    return {"reports": reports}

@with_locale
def technical_reports_get(params: dict[str, Any]) -> dict[str, Any]:
    report_id = get_item_id(params)
    return {"report": get_item_or_raise(_db(), report_id, "Informe no encontrado")}

@with_locale
def technical_reports_create(params: dict[str, Any]) -> dict[str, Any]:
    created = create_report_from_params(_db(), params, "report")
    return {"success": True, "report": created}

@with_locale
def technical_reports_update(params: dict[str, Any]) -> dict[str, Any]:
    report_id, report = require_update_payload(params, "report")
    return {"success": True, "report": update_item_or_raise(_db(), report_id, report)}

@with_locale
def technical_reports_delete(params: dict[str, Any]) -> dict[str, Any]:
    report_id = get_item_id(params)
    delete_item_or_raise(_db(), report_id, "Informe no encontrado")
    return {"success": True, "deleted_id": report_id}

@with_locale
def technical_reports_clear(params: dict[str, Any]) -> dict[str, Any]:
    return clear_store(_db(), "informes")

@with_locale
def technical_reports_import_file(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.technical_reports.importer import import_reports_from_bytes
    filename = str(params.get("filename") or "")
    content_b64 = str(params.get("content_b64") or "")
    if not filename or not content_b64:
        msg = "filename y content_b64 son requeridos"
        raise ValueError(msg)

    content = decode_b64_payload(content_b64)
    reports = import_reports_from_bytes(filename, content)
    db = _db()
    deleted_count = len(db.get_all())
    imported = db.replace_all(reports)
    return {"success": True, "message": f"{len(imported)} informes importados", "deleted_count": deleted_count, "imported_count": len(imported), "total_rows_in_file": len(reports)}


def technical_reports_autocomplete_cs(params: dict[str, Any]) -> dict[str, Any]:
    return {"options": _db().get_unique_cs()}

@with_locale
def technical_reports_autocomplete_contratista(params: dict[str, Any]) -> dict[str, Any]:
    cs = str(params.get("cs") or "").strip()
    return {"options": _db().get_unique_contratista(cs if cs else None)}

def _resolve_report_for_render(params: dict[str, Any]) -> dict[str, Any]:
    report_payload = params.get("report")
    report_id = str(params.get("id") or "").strip()

    if isinstance(report_payload, dict) and report_payload:
        return report_payload

    if report_id:
        stored = _db().get(report_id)
        if isinstance(stored, dict):
            return stored

    msg = "Informe no encontrado: envíe el report actual o un id válido"
    raise ValueError(msg)


@with_locale
def technical_reports_render_html(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.technical_reports.rendering import render_report_html

    report = _resolve_report_for_render(params)
    html = render_report_html(report, params.get("logo_left"), params.get("logo_right"))
    return {"html": html, "filename": f"informe_{report.get('id') or 'inline'}.pdf"}

@with_locale
def technical_reports_render_consolidated_html(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.technical_reports.rendering import render_consolidated_html
    reports = _db().get_all()
    report_ids = params.get("report_ids")
    if isinstance(report_ids, list) and report_ids:
        allowed = {str(rid) for rid in report_ids}
        reports = [r for r in reports if r["id"] in allowed]
    if not reports:
        msg = "No hay informes para exportar"
        raise ValueError(msg)
    reports.sort(key=lambda r: int(r["metadata"].get("informe_id", 0)))
    html = render_consolidated_html(reports, params.get("logo_left"), params.get("logo_right"))
    return {"html": html, "filename": f"informes_tecnicos_consolidado_{len(reports)}.pdf", "count": len(reports)}

HANDLERS = {
    "technical_reports_list": technical_reports_list,
    "technical_reports_get": technical_reports_get,
    "technical_reports_create": technical_reports_create,
    "technical_reports_update": technical_reports_update,
    "technical_reports_delete": technical_reports_delete,
    "technical_reports_clear": technical_reports_clear,
    "technical_reports_import_file": technical_reports_import_file,
    "technical_reports_autocomplete_cs": technical_reports_autocomplete_cs,
    "technical_reports_autocomplete_contratista": technical_reports_autocomplete_contratista,
    "technical_reports_render_html": technical_reports_render_html,
    "technical_reports_render_consolidated_html": technical_reports_render_consolidated_html,
}
