from __future__ import annotations

import base64
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
    report_id = get_item_id(params)
    return {"report": get_item_or_raise(_db(), report_id, "Informe no encontrado")}


@with_locale
def informes_v2_create(params: dict[str, Any]) -> dict[str, Any]:
    created = create_report_from_params(_db(), params, "report")
    return {"success": True, "report": created}


@with_locale
def informes_v2_update(params: dict[str, Any]) -> dict[str, Any]:
    report_id, report = require_update_payload(params, "report")
    return {"success": True, "report": update_item_or_raise(_db(), report_id, report)}


@with_locale
def informes_v2_delete(params: dict[str, Any]) -> dict[str, Any]:
    report_id = get_item_id(params)
    delete_item_or_raise(_db(), report_id, "Informe no encontrado")
    return {"success": True, "deleted_id": report_id}


@with_locale
def informes_v2_clear(params: dict[str, Any]) -> dict[str, Any]:
    return clear_store(_db(), "informes")


@with_locale
def informes_v2_import_file(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.informes_v2.importer import import_reports_from_bytes

    filename, content = require_b64_file_payload(params)
    reports = import_reports_from_bytes(filename, content)
    imported, deleted_count = _db().replace_all_counted(reports)
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


def _parse_image_items(images: Any, *, allow_strings: bool = False) -> list[dict[str, str]]:
    if not isinstance(images, list):
        return []
    parsed: list[dict[str, str]] = []
    for item in images:
        if isinstance(item, dict):
            path = str(item.get("path") or item.get("src") or "")
            if path:
                parsed.append({"path": path, "name": str(item.get("name") or "")})
        elif allow_strings and isinstance(item, str) and item:
            parsed.append({"path": item, "name": ""})
    return parsed


def _parse_images(params: dict[str, Any]) -> list[dict[str, str]] | None:
    images = params.get("images")
    if not isinstance(images, list):
        return None
    return _parse_image_items(images, allow_strings=True)


@with_locale
def informes_v2_render_html(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.informes_v2.rendering import render_report_html

    report = resolve_payload_or_store(
        _db(), params, "report", "Informe no encontrado: envíe el report actual o un id válido"
    )
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

    reports = filter_by_optional_ids(
        _db().get_all(), params.get("report_ids"), "No hay informes para exportar"
    )
    reports.sort(key=lambda r: int(r["metadata"].get("informe_id", 0)))

    images_by_id: dict[str, list[dict[str, str]]] = {}
    raw_map = params.get("images_by_id")
    if isinstance(raw_map, dict):
        for key, value in raw_map.items():
            if isinstance(value, list):
                images_by_id[str(key)] = _parse_image_items(value)

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
