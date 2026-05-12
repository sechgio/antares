"""Technical reports handlers."""
from __future__ import annotations
import base64
from typing import Any
from backend.handlers.common import with_locale

def _summary(report: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": report["id"],
        "metadata": {"informe_id": report["metadata"].get("informe_id", 0)},
        "header": {"cs": report["header"].get("cs", ""), "codigo_infraestructura": report["header"].get("codigo_infraestructura", "")},
        "status": report.get("status", "draft"),
    }

@with_locale
def technical_reports_list(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.technical_reports.database import TechnicalReportsDB
    reports = TechnicalReportsDB().get_all()
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
    from backend.core.technical_reports.database import TechnicalReportsDB
    report_id = str(params.get("id") or "")
    report = TechnicalReportsDB().get(report_id)
    if report is None:
        raise ValueError(f"Informe no encontrado: {report_id}")
    return {"report": report}

@with_locale
def technical_reports_create(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.technical_reports.database import TechnicalReportsDB
    db = TechnicalReportsDB()
    report = params.get("report")
    created = db.create(report) if isinstance(report, dict) else db.create_empty()
    return {"success": True, "report": created}

@with_locale
def technical_reports_update(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.technical_reports.database import TechnicalReportsDB
    report_id = str(params.get("id") or "")
    report = params.get("report")
    if not report_id or not isinstance(report, dict):
        raise ValueError("id y report son requeridos")
    return {"success": True, "report": TechnicalReportsDB().update(report_id, report)}

@with_locale
def technical_reports_delete(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.technical_reports.database import TechnicalReportsDB
    report_id = str(params.get("id") or "")
    if not TechnicalReportsDB().delete(report_id):
        raise ValueError(f"Informe no encontrado: {report_id}")
    return {"success": True, "deleted_id": report_id}

@with_locale
def technical_reports_clear(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.technical_reports.database import TechnicalReportsDB
    count = TechnicalReportsDB().clear_all()
    return {"success": True, "deleted_count": count, "message": f"Se eliminaron {count} informes"}

@with_locale
def technical_reports_import_file(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.technical_reports.database import TechnicalReportsDB
    from backend.core.technical_reports.importer import import_reports_from_bytes
    filename = str(params.get("filename") or "")
    content_b64 = str(params.get("content_b64") or "")
    if not filename or not content_b64:
        raise ValueError("filename y content_b64 son requeridos")
    content = base64.b64decode(content_b64)
    reports = import_reports_from_bytes(filename, content)
    db = TechnicalReportsDB()
    deleted_count = len(db.get_all())
    imported = db.replace_all(reports)
    return {"success": True, "message": f"{len(imported)} informes importados", "deleted_count": deleted_count, "imported_count": len(imported), "total_rows_in_file": len(reports)}

@with_locale
def technical_reports_variables(params: dict[str, Any]) -> dict[str, Any]:
    return {"variables": [
        {"key": "metadata.informe_id", "label": "Numero de informe", "category": "Identificadores"},
        {"key": "header.cs", "label": "Centro de servicio", "category": "Infraestructura"},
        {"key": "header.codigo_infraestructura", "label": "Codigo de infraestructura", "category": "Infraestructura"},
        {"key": "inspeccion.caja_registro", "label": "Caja de registro", "category": "Inspeccion"},
        {"key": "valvulas.operativas", "label": "Valvulas operativas", "category": "Valvulas"},
        {"key": "canastillas.operativas", "label": "Canastillas operativas", "category": "Canastillas"},
        {"key": "medidas.altura_total", "label": "Altura total", "category": "Medidas"},
    ]}

@with_locale
def technical_reports_autocomplete_cs(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.technical_reports.database import TechnicalReportsDB
    reports = TechnicalReportsDB().get_all()
    return {"options": sorted({r["header"].get("cs", "") for r in reports if r["header"].get("cs")})}

@with_locale
def technical_reports_autocomplete_contratista(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.technical_reports.database import TechnicalReportsDB
    cs = str(params.get("cs") or "").strip()
    reports = TechnicalReportsDB().get_all()
    if cs:
        reports = [r for r in reports if r["header"].get("cs") == cs]
    return {"options": sorted({r["header"].get("contratista", "") for r in reports if r["header"].get("contratista")})}

@with_locale
def technical_reports_render_html(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.technical_reports.database import TechnicalReportsDB
    from backend.core.technical_reports.rendering import render_report_html
    report = params.get("report")
    report_id = str(params.get("id") or "")
    if not isinstance(report, dict):
        report = TechnicalReportsDB().get(report_id)
    if not isinstance(report, dict):
        raise ValueError(f"Informe no encontrado: {report_id}")
    html = render_report_html(report, params.get("logo_left"), params.get("logo_right"))
    return {"html": html, "filename": f"informe_{report['id']}.pdf"}

@with_locale
def technical_reports_render_consolidated_html(params: dict[str, Any]) -> dict[str, Any]:
    from backend.core.technical_reports.database import TechnicalReportsDB
    from backend.core.technical_reports.rendering import render_consolidated_html
    reports = TechnicalReportsDB().get_all()
    report_ids = params.get("report_ids")
    if isinstance(report_ids, list) and report_ids:
        allowed = {str(rid) for rid in report_ids}
        reports = [r for r in reports if r["id"] in allowed]
    if not reports:
        raise ValueError("No hay informes para exportar")
    reports.sort(key=lambda r: int(r["metadata"].get("informe_id", 0)))
    html = render_consolidated_html(reports, params.get("logo_left"), params.get("logo_right"))
    return {"html": html, "filename": f"informes_tecnicos_consolidado_{len(reports)}.pdf", "count": len(reports)}

@with_locale
def html_to_pdf(params: dict[str, Any]) -> dict[str, str]:
    import io
    from weasyprint import HTML
    html = str(params.get("html") or "")
    filename = str(params.get("filename") or "documento.pdf")
    if not html:
        raise ValueError("html es requerido")
    if not filename.lower().endswith(".pdf"):
        filename += ".pdf"
    pdf_buffer = io.BytesIO()
    HTML(string=html).write_pdf(pdf_buffer)
    return {"pdf_base64": base64.b64encode(pdf_buffer.getvalue()).decode("ascii"), "filename": filename}

HANDLERS = {
    "technical_reports_list": technical_reports_list,
    "technical_reports_get": technical_reports_get,
    "technical_reports_create": technical_reports_create,
    "technical_reports_update": technical_reports_update,
    "technical_reports_delete": technical_reports_delete,
    "technical_reports_clear": technical_reports_clear,
    "technical_reports_import_file": technical_reports_import_file,
    "technical_reports_variables": technical_reports_variables,
    "technical_reports_autocomplete_cs": technical_reports_autocomplete_cs,
    "technical_reports_autocomplete_contratista": technical_reports_autocomplete_contratista,
    "technical_reports_render_html": technical_reports_render_html,
    "technical_reports_render_consolidated_html": technical_reports_render_consolidated_html,
    "html_to_pdf": html_to_pdf,
}
