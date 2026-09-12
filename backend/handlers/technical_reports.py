from __future__ import annotations

from typing import Any

from backend.handlers.common import (
    clear_store,
    create_report_from_params,
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
    filename, content = require_b64_file_payload(params)
    reports = import_reports_from_bytes(filename, content)
    imported, deleted_count = _db().replace_all_counted(reports)
    return {"success": True, "message": f"{len(imported)} informes importados", "deleted_count": deleted_count, "imported_count": len(imported), "total_rows_in_file": len(reports)}


def technical_reports_autocomplete_cs(params: dict[str, Any]) -> dict[str, Any]:
    return {"options": _db().get_unique_cs()}

@with_locale
def technical_reports_autocomplete_contratista(params: dict[str, Any]) -> dict[str, Any]:
    cs = str(params.get("cs") or "").strip()
    return {"options": _db().get_unique_contratista(cs if cs else None)}

@with_locale
def technical_reports_render_html(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.technical_reports.rendering import render_report_html

    report = resolve_payload_or_store(
        _db(), params, "report", "Informe no encontrado: envíe el report actual o un id válido"
    )
    html = render_report_html(report, params.get("logo_left"), params.get("logo_right"))
    return {"html": html, "filename": f"informe_{report.get('id') or 'inline'}.pdf"}

@with_locale
def technical_reports_render_consolidated_html(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.technical_reports.rendering import render_consolidated_html
    reports = filter_by_optional_ids(
        _db().get_all(), params.get("report_ids"), "No hay informes para exportar"
    )
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
