from __future__ import annotations

import base64
from typing import Any

from backend.handlers.common import (
    clear_store,
    create_report_from_params,
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
    status = str(params.get("status") or "").strip()
    query = str(params.get("q") or "").strip().lower()

    def matches(report: dict[str, Any]) -> bool:  # allowlist: dict[str, Any]
        return (not status or report.get("status") == status) and (
            not query
            or query in str(report["header"].get("estacion", "")).lower()
            or query in str(report["header"].get("suministro", "")).lower()
            or query in str(report["header"].get("photo_id", "")).lower()
            or query in str(report["id"]).lower()
        )

    store = _db()
    if params.get("summary"):
        reports = store.project_all(_summary, matches)
    else:
        reports = [report for report in store.get_all() if matches(report)]
    reports.sort(key=lambda r: int(r["metadata"].get("informe_id", 0)))
    return {"items": reports, "total": len(reports)}


@with_locale
def informes_v2_get(params: dict[str, Any]) -> dict[str, Any]:
    report_id = get_item_id(params)
    return {"item": get_item_or_raise(_db(), report_id, "Informe no encontrado")}


@with_locale
def informes_v2_create(params: dict[str, Any]) -> dict[str, Any]:
    created = create_report_from_params(_db(), params, "report")
    return {"success": True, "item": created}


@with_locale
def informes_v2_update(params: dict[str, Any]) -> dict[str, Any]:
    report_id, report = require_update_payload(params, "report")
    return {"success": True, "item": update_item_or_raise(_db(), report_id, report)}


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

    plantilla = str(params.get("plantilla") or "").strip()

    def importer(filename: str, content: bytes) -> list[dict[str, Any]]:
        return import_reports_from_bytes(filename, content, plantilla)

    return import_into_store(_db(), params, importer, "informes importados")


@with_locale
def informes_v2_download_template(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.informes_v2.template_xlsx import build_template_xlsx_bytes

    plantilla = str(params.get("plantilla") or "clasica").strip()
    is_reservorios2 = plantilla == "reservorios2"
    content = build_template_xlsx_bytes(plantilla)
    return {
        "filename": "informes_v2_plantilla_nueva.xlsx" if is_reservorios2 else "informes_v2_plantilla.xlsx",
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

    reports = get_items_by_optional_ids(
        _db(), params.get("report_ids"), "No hay informes para exportar"
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
