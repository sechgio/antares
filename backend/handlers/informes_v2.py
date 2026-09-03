from __future__ import annotations

import base64
from typing import Any

from backend.handlers.common import with_locale
from backend.utils.image_data import decode_b64_payload


def _db():
    from backend.core.informes_v2.database import get_informes_v2_db

    return get_informes_v2_db()


def _summary(report: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": report["id"],
        "metadata": {"informe_id": report["metadata"].get("informe_id", 0)},
        "header": {
            "photo_id": report["header"].get("photo_id", ""),
            "estacion": report["header"].get("estacion", ""),
            "suministro": report["header"].get("suministro", ""),
            "distrito": report["header"].get("distrito", ""),
        },
        "status": report.get("status", "draft"),
    }


@with_locale
def informes_v2_list(params: dict[str, Any]) -> dict[str, Any]:
    reports = _db().get_all()
    status = str(params.get("status") or "").strip()
    query = str(params.get("q") or "").strip().lower()
    if status:
        reports = [r for r in reports if r.get("status") == status]
    if query:
        reports = [
            r
            for r in reports
            if query in str(r["header"].get("estacion", "")).lower()
            or query in str(r["header"].get("suministro", "")).lower()
            or query in str(r["header"].get("photo_id", "")).lower()
            or query in str(r["id"]).lower()
        ]
    reports.sort(key=lambda r: int(r["metadata"].get("informe_id", 0)))
    if params.get("summary"):
        reports = [_summary(r) for r in reports]
    return {"reports": reports}


@with_locale
def informes_v2_get(params: dict[str, Any]) -> dict[str, Any]:
    report_id = str(params.get("id") or "")
    report = _db().get(report_id)
    if report is None:
        msg = f"Informe no encontrado: {report_id}"
        raise ValueError(msg)
    return {"report": report}


@with_locale
def informes_v2_create(params: dict[str, Any]) -> dict[str, Any]:
    db = _db()
    report = params.get("report")
    created = db.create(report) if isinstance(report, dict) else db.create_empty()
    return {"success": True, "report": created}


@with_locale
def informes_v2_update(params: dict[str, Any]) -> dict[str, Any]:
    report_id = str(params.get("id") or "")
    report = params.get("report")
    if not report_id or not isinstance(report, dict):
        msg = "id y report son requeridos"
        raise ValueError(msg)
    return {"success": True, "report": _db().update(report_id, report)}


@with_locale
def informes_v2_delete(params: dict[str, Any]) -> dict[str, Any]:
    report_id = str(params.get("id") or "")
    if not _db().delete(report_id):
        msg = f"Informe no encontrado: {report_id}"
        raise ValueError(msg)
    return {"success": True, "deleted_id": report_id}


@with_locale
def informes_v2_clear(params: dict[str, Any]) -> dict[str, Any]:
    count = _db().clear_all()
    return {"success": True, "deleted_count": count, "message": f"Se eliminaron {count} informes"}


@with_locale
def informes_v2_import_file(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.informes_v2.importer import import_reports_from_bytes

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
    return {
        "success": True,
        "message": f"{len(imported)} informes importados",
        "deleted_count": deleted_count,
        "imported_count": len(imported),
        "total_rows_in_file": len(reports),
    }


@with_locale
def informes_v2_download_template(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.informes_v2.template_xlsx import build_template_xlsx_bytes

    content = build_template_xlsx_bytes()
    return {
        "filename": "informes_v2_plantilla.xlsx",
        "content_b64": base64.b64encode(content).decode("ascii"),
        "mime": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }


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


def _parse_images(params: dict[str, Any]) -> list[dict[str, str]] | None:
    images = params.get("images")
    if not isinstance(images, list):
        return None
    parsed: list[dict[str, str]] = []
    for item in images:
        if isinstance(item, dict):
            path = str(item.get("path") or item.get("src") or "")
            if path:
                parsed.append({"path": path, "name": str(item.get("name") or "")})
        elif isinstance(item, str) and item:
            parsed.append({"path": item, "name": ""})
    return parsed


@with_locale
def informes_v2_render_html(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.informes_v2.rendering import render_report_html

    report = _resolve_report_for_render(params)
    html = render_report_html(
        report,
        params.get("logo_left"),
        params.get("logo_right"),
        _parse_images(params),
    )
    return {"html": html, "filename": f"informe_v2_{report.get('id') or 'inline'}.pdf"}


@with_locale
def informes_v2_render_consolidated_html(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.informes_v2.rendering import render_consolidated_html

    reports = _db().get_all()
    report_ids = params.get("report_ids")
    if isinstance(report_ids, list) and report_ids:
        allowed = {str(rid) for rid in report_ids}
        reports = [r for r in reports if r["id"] in allowed]
    if not reports:
        msg = "No hay informes para exportar"
        raise ValueError(msg)
    reports.sort(key=lambda r: int(r["metadata"].get("informe_id", 0)))

    images_by_id: dict[str, list[dict[str, str]]] = {}
    raw_map = params.get("images_by_id")
    if isinstance(raw_map, dict):
        for key, value in raw_map.items():
            if isinstance(value, list):
                images_by_id[str(key)] = [
                    {"path": str(i.get("path") or i.get("src") or ""), "name": str(i.get("name") or "")}
                    for i in value
                    if isinstance(i, dict) and (i.get("path") or i.get("src"))
                ]

    html = render_consolidated_html(
        reports,
        params.get("logo_left"),
        params.get("logo_right"),
        images_by_id,
    )
    return {"html": html, "filename": f"informes_v2_consolidado_{len(reports)}.pdf", "count": len(reports)}


HANDLERS = {
    "informes_v2_list": informes_v2_list,
    "informes_v2_get": informes_v2_get,
    "informes_v2_create": informes_v2_create,
    "informes_v2_update": informes_v2_update,
    "informes_v2_delete": informes_v2_delete,
    "informes_v2_clear": informes_v2_clear,
    "informes_v2_import_file": informes_v2_import_file,
    "informes_v2_download_template": informes_v2_download_template,
    "informes_v2_render_html": informes_v2_render_html,
    "informes_v2_render_consolidated_html": informes_v2_render_consolidated_html,
}
