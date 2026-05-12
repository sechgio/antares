"""Panel Aviso de Corte handlers."""
from __future__ import annotations
import base64
from typing import Any
from backend.handlers.common import with_locale
from backend.core.panel_aviso_corte import build_panels, parse_excel_bytes, render_docx, render_pdf
from backend.core.panel_aviso_corte.models import MatchRule
from backend.core.panel_aviso_corte.serialization import deserialize_panel

@with_locale
def panel_aviso_corte_parse_excel(params: dict[str, Any]) -> dict[str, Any]:
    xlsx_b64 = params.get("xlsx_b64", "")
    if not xlsx_b64:
        raise ValueError("xlsx_b64 es requerido")
    try:
        content = base64.b64decode(xlsx_b64, validate=True)
    except Exception as exc:
        raise ValueError(f"xlsx_b64 no es base64 válido: {exc}") from exc
    source = parse_excel_bytes(content, params.get("filename", "datos.xlsx"))
    return {
        "columns": list(source.columns),
        "normalizedColumns": list(source.normalized_columns),
        "rows": [dict(r) for r in source.rows],
        "warnings": list(source.warnings),
    }

@with_locale
def panel_aviso_corte_compute_match(params: dict[str, Any]) -> dict[str, Any]:
    rows = params.get("rows", [])
    key_column = str(params.get("key_column", ""))
    strategy = str(params.get("strategy", "prefix"))
    pattern = params.get("pattern")
    address_column = params.get("address_column")
    image_names = params.get("image_names", [])
    export_mode = str(params.get("export_mode", "skip_empty"))
    if not rows:
        raise ValueError("rows es requerido")
    if not key_column:
        raise ValueError("key_column es requerido")
    if not image_names:
        raise ValueError("image_names es requerido")
    columns = tuple(str(k) for k in rows[0]) if rows else ()
    from backend.core.panel_aviso_corte.importer import _normalize_column_name
    normalized_columns = tuple(_normalize_column_name(c) for c in columns)
    from backend.core.panel_aviso_corte.models import ExcelSource
    excel_source = ExcelSource(filename="inline.xlsx", columns=columns, normalized_columns=normalized_columns, rows=tuple(dict(r) for r in rows))
    rule = MatchRule(key_column=key_column, strategy=strategy, regex_pattern=pattern if pattern else None)  # type: ignore[arg-type]
    result = build_panels(source=excel_source, rule=rule, image_names=image_names, address_column=address_column if address_column else None, export_mode=export_mode)  # type: ignore[arg-type]
    from backend.core.panel_aviso_corte.serialization import serialize_panel
    return {
        "panels": [serialize_panel(p) for p in result.panels],
        "summary": {
            "total_rows": result.summary.total_rows, "rows_with_images": result.summary.rows_with_images,
            "rows_without_images": result.summary.rows_without_images, "total_images": result.summary.total_images,
            "matched_images": result.summary.matched_images, "unmatched_images": result.summary.unmatched_images,
            "unmatched_image_names": list(result.summary.unmatched_image_names),
            "rows_without_images_keys": list(result.summary.rows_without_images_keys),
        },
        "warnings": list(result.warnings),
    }

@with_locale
def panel_aviso_corte_render_pdf(params: dict[str, Any]) -> dict[str, Any]:
    panels_raw = params.get("panels", [])
    logos_raw = params.get("logos", {})
    images_raw = params.get("images", {})
    fmt = str(params.get("format", "pdf")).lower()
    if not panels_raw:
        raise ValueError("panels es requerido")
    panels = tuple(deserialize_panel(p) for p in panels_raw)
    logos = {"left": logos_raw.get("left_b64") or None, "right": logos_raw.get("right_b64") or None}
    images = {str(k): str(v) for k, v in images_raw.items()}
    if fmt == "docx":
        docx_bytes, filename = render_docx(panels=panels, logos=logos, images=images, export_mode="include_empty")
        return {"pdf_base64": base64.b64encode(docx_bytes).decode("ascii"), "filename": filename}
    pdf_bytes, filename = render_pdf(panels=panels, logos=logos, images=images, export_mode="include_empty")
    return {"pdf_base64": base64.b64encode(pdf_bytes).decode("ascii"), "filename": filename}

@with_locale
def panel_aviso_corte_template(params: dict[str, Any]) -> dict[str, Any]:
    path = params.get("path", "")
    if path and not path.lower().endswith('.xlsx'):
        path = path + '.xlsx'
    
    try:
        import pandas as pd  # type: ignore
    except ImportError as exc:
        raise ImportError("pandas no está instalado.") from exc

    columns = [
        "ID", 
        "DIRECCION", 
        "FECHA DE CORTE", 
        "CUADRANTE AFECTADO", 
        "MOTIVO"
    ]
    df = pd.DataFrame(columns=columns)
    
    data = [
        ["1001", "Calle Las Flores 123, Urbanización Santa Rosa", "2024-05-15", "CUADRANTE A-12", "Mantenimiento Preventivo de Redes"],
        ["1002", "Av. Principal 456, Sector 4", "2024-05-15", "CUADRANTE B-05", "Reparación de Tubería Matriz"],
        ["1003", "Jr. Independencia 789", "2024-05-16", "CUADRANTE C-08", "Mejora de Presión en la Zona"],
        ["1004", "Pasaje El Olivo 101", "2024-05-17", "CUADRANTE D-11", "Conexión de Nuevas Redes"],
    ]
    
    for i, row in enumerate(data):
        df.loc[i] = row
        
    df.to_excel(path, index=False, engine='openpyxl')
    return {"path": path}

HANDLERS = {
    "panel_aviso_corte_parse_excel": panel_aviso_corte_parse_excel,
    "panel_aviso_corte_compute_match": panel_aviso_corte_compute_match,
    "panel_aviso_corte_render_pdf": panel_aviso_corte_render_pdf,
    "panel_aviso_corte_template": panel_aviso_corte_template,
}
