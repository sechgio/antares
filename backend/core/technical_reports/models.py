from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from typing import Any

CHECK_STATES = {"normal", "critico", "unchecked"}
REPORT_TYPES = {"ELEVADO", "ENTERRADO", "SEMIENTERRADO", "APOYADO", "CISTERNA"}

INSPECTION_ITEMS = [
    "caja_registro",
    "marco_tapa",
    "escalera_interior",
    "escalera_exterior",
    "cuba_interior",
    "cuba_exterior",
    "loza_fondo",
    "loza_techo_interior",
    "loza_techo_exterior",
    "ducto_ventilacion",
    "cerco_perimetrico",
    "descarga",
]

INSPECTION_TEXT_FIELDS = {
    "caja_registro": ("observaciones_caja_registro", "sugerencias_caja_registro"),
    "marco_tapa": ("observaciones_marco_tapa", "sugerencias_marco_tapa"),
    "escalera_interior": ("observaciones_escalera_int", "sugerencias_escalera_int"),
    "escalera_exterior": ("observaciones_escalera_ext", "sugerencias_escalera_ext"),
    "cuba_interior": ("observaciones_cuba_int", "sugerencias_cuba_int"),
    "cuba_exterior": ("observaciones_cuba_ext", "sugerencias_cuba_ext"),
    "loza_fondo": ("observaciones_loza_fondo", "sugerencias_loza_fondo"),
    "loza_techo_interior": ("observaciones_loza_techo_int", "sugerencias_loza_techo_int"),
    "loza_techo_exterior": ("observaciones_loza_techo_ext", "sugerencias_loza_techo_ext"),
    "ducto_ventilacion": ("observaciones_ducto", "sugerencias_ducto"),
    "cerco_perimetrico": ("observaciones_cerco", "sugerencias_cerco"),
    "descarga": ("observaciones_descarga", "sugerencias_descarga"),
}

VALVULA_DIAMETERS = ["2", "3", "4", "6", "8", "10", "12"]
CANASTILLA_DIAMETERS = ["2", "3", "4", "6", "8", "10", "14"]


def report_id_from_number(value: int) -> str:
    return f"RPT-{int(value):04d}"


def _safe_int(value: Any, default: int = 0) -> int:
    if value is None or value == "":
        return default
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _safe_str(value: Any, default: str = "") -> str:
    if value is None:
        return default
    text = str(value).strip()
    return text or default


def _diameter_map(diameters: list[str], source: dict[str, Any] | None = None) -> dict[str, int]:
    source = source if isinstance(source, dict) else {}
    return {diameter: _safe_int(source.get(diameter), 0) for diameter in diameters}


def default_metadata(informe_id: int) -> dict[str, Any]:
    now = datetime.now()
    return {
        "informe_id": int(informe_id),
        "dia": now.day,
        "mes": "ENERO",
        "anio": now.year,
        "pagina": "1 de 2",
    }


def default_header() -> dict[str, Any]:
    return {
        "cs": "",
        "contratista": "",
        "codigo_infraestructura": "",
        "ubicacion": "",
        "suministro": "",
        "tipo": "ELEVADO",
        "volumen": 0,
    }


def default_inspeccion() -> dict[str, Any]:
    data: dict[str, Any] = dict.fromkeys(INSPECTION_ITEMS, "unchecked")
    for obs_key, sug_key in INSPECTION_TEXT_FIELDS.values():
        data[obs_key] = ""
        data[sug_key] = ""
    return data


def default_valvulas() -> dict[str, Any]:
    data: dict[str, Any] = {
        "diametros": _diameter_map(VALVULA_DIAMETERS),
        "impulsion": _diameter_map(VALVULA_DIAMETERS),
        "aduccion": _diameter_map(VALVULA_DIAMETERS),
        "bypass": _diameter_map(VALVULA_DIAMETERS),
        "desague": _diameter_map(VALVULA_DIAMETERS),
        "operativas": 0,
        "no_operativas": 0,
    }
    for key in ["conduccion", "impulsion", "aduccion", "bypass", "desague"]:
        data[f"observaciones_{key}"] = ""
        data[f"sugerencias_{key}"] = ""
    return data


def default_canastillas() -> dict[str, Any]:
    data: dict[str, Any] = {
        "diametros": _diameter_map(CANASTILLA_DIAMETERS),
        "aduccion": _diameter_map(CANASTILLA_DIAMETERS),
        "succion": _diameter_map(CANASTILLA_DIAMETERS),
        "desague": _diameter_map(CANASTILLA_DIAMETERS),
        "operativas": 0,
        "no_operativas": 0,
    }
    for key in ["aduccion", "succion", "desague"]:
        data[f"observaciones_{key}"] = ""
        data[f"sugerencias_{key}"] = ""
    return data


def default_medidas() -> dict[str, str]:
    return {
        "diametro": "",
        "diametro_interno": "",
        "altura_util": "",
        "altura_total": "",
    }


def create_empty_report(informe_id: int) -> dict[str, Any]:
    report_id = report_id_from_number(informe_id)
    return {
        "id": report_id,
        "metadata": default_metadata(informe_id),
        "header": default_header(),
        "inspeccion": default_inspeccion(),
        "valvulas": default_valvulas(),
        "canastillas": default_canastillas(),
        "medidas": default_medidas(),
        "observaciones": "",
        "sugerencias": "",
        "status": "draft",
        "last_modified": datetime.now().isoformat(),
    }


class TechnicalReport:
    """Dictionary based report normalizer for IPC-friendly data."""

    @staticmethod
    def normalize(data: dict[str, Any] | None) -> dict[str, Any]:
        source = data if isinstance(data, dict) else {}
        metadata_source = source.get("metadata") if isinstance(source.get("metadata"), dict) else {}
        informe_id = _safe_int(metadata_source.get("informe_id") or source.get("informe_id"), 1)
        report = create_empty_report(informe_id)
        report["id"] = _safe_str(source.get("id"), report_id_from_number(informe_id))

        metadata = deepcopy(report["metadata"])
        metadata.update({k: v for k, v in metadata_source.items() if v is not None})
        metadata["informe_id"] = _safe_int(metadata.get("informe_id"), informe_id)
        metadata["dia"] = _safe_int(metadata.get("dia"), report["metadata"]["dia"])
        metadata["anio"] = _safe_int(metadata.get("anio"), report["metadata"]["anio"])
        metadata["mes"] = _safe_str(metadata.get("mes"), "ENERO").upper()
        metadata["pagina"] = _safe_str(metadata.get("pagina"), "1 de 2")
        report["metadata"] = metadata

        header = deepcopy(report["header"])
        header_source = source.get("header") if isinstance(source.get("header"), dict) else {}
        header.update({k: v for k, v in header_source.items() if v is not None})
        header["tipo"] = _safe_str(header.get("tipo"), "ELEVADO").upper()
        if header["tipo"] not in REPORT_TYPES:
            header["tipo"] = "ELEVADO"
        header["volumen"] = _safe_int(header.get("volumen"), 0)
        for key in ["cs", "contratista", "codigo_infraestructura", "ubicacion", "suministro"]:
            header[key] = _safe_str(header.get(key), "")
        report["header"] = header

        report["inspeccion"] = _normalize_inspeccion(source.get("inspeccion"))
        report["valvulas"] = _normalize_valvulas(source.get("valvulas"))
        report["canastillas"] = _normalize_canastillas(source.get("canastillas"))
        medidas = default_medidas()
        if isinstance(source.get("medidas"), dict):
            medidas.update({k: _safe_str(v, "") for k, v in source["medidas"].items()})
        report["medidas"] = medidas
        report["observaciones"] = _safe_str(source.get("observaciones"), "")
        report["sugerencias"] = _safe_str(source.get("sugerencias"), "")
        report["status"] = source.get("status") if source.get("status") in {"draft", "completed"} else "draft"
        report["last_modified"] = _safe_str(source.get("last_modified"), datetime.now().isoformat())
        return report


def _normalize_inspeccion(source: Any) -> dict[str, Any]:
    data = default_inspeccion()
    if not isinstance(source, dict):
        return data
    for item in INSPECTION_ITEMS:
        value = _safe_str(source.get(item), "unchecked").lower()
        data[item] = value if value in CHECK_STATES else "unchecked"
    for obs_key, sug_key in INSPECTION_TEXT_FIELDS.values():
        data[obs_key] = _safe_str(source.get(obs_key), "")
        data[sug_key] = _safe_str(source.get(sug_key), "")
    return data


def _normalize_valvulas(source: Any) -> dict[str, Any]:
    data = default_valvulas()
    if not isinstance(source, dict):
        return data
    for section in ["diametros", "impulsion", "aduccion", "bypass", "desague"]:
        data[section] = _diameter_map(VALVULA_DIAMETERS, source.get(section))
    data["operativas"] = _safe_int(source.get("operativas"), 0)
    data["no_operativas"] = _safe_int(source.get("no_operativas"), 0)
    for key in ["conduccion", "impulsion", "aduccion", "bypass", "desague"]:
        data[f"observaciones_{key}"] = _safe_str(source.get(f"observaciones_{key}"), "")
        data[f"sugerencias_{key}"] = _safe_str(source.get(f"sugerencias_{key}"), "")
    return data


def _normalize_canastillas(source: Any) -> dict[str, Any]:
    data = default_canastillas()
    if not isinstance(source, dict):
        return data
    for section in ["diametros", "aduccion", "succion", "desague"]:
        data[section] = _diameter_map(CANASTILLA_DIAMETERS, source.get(section))
    data["operativas"] = _safe_int(source.get("operativas"), 0)
    data["no_operativas"] = _safe_int(source.get("no_operativas"), 0)
    for key in ["aduccion", "succion", "desague"]:
        data[f"observaciones_{key}"] = _safe_str(source.get(f"observaciones_{key}"), "")
        data[f"sugerencias_{key}"] = _safe_str(source.get(f"sugerencias_{key}"), "")
    return data


def next_technical_report_number(reports: list[dict[str, Any]]) -> int:
    """Return the next sequential informe_id from existing reports."""
    current = 0
    for report in reports:
        try:
            current = max(current, int(report.get("metadata", {}).get("informe_id", 0)))
        except (TypeError, ValueError):
            continue
    return current + 1
