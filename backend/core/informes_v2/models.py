from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime
from typing import Any

REPORT_TYPES = {"ELEVADO", "ENTERRADO", "SEMIENTERRADO", "APOYADO", "CISTERNA"}
DIAMETERS = ["2", "4", "6", "8", "10", "12", "14", "16"]
VALVULA_ROWS = ["conduccion", "impulsion", "aduccion", "bypass", "purga"]
LINEA_ROWS = ["aduccion", "alimentacion", "impulsion_rebombeo", "rebose", "purga"]
MEDIDA_FIELDS = [
    "largo",
    "ancho",
    "diametro",
    "altura_rebose",
    "altura_total",
    "tirante_limpieza",
]


def report_id_from_number(value: int) -> str:
    return f"IV2-{int(value):04d}"


def _safe_int(value: Any, default: int = 0) -> int:
    if value is None or value == "":
        return default
    if isinstance(value, (datetime, date)):
        return default
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _safe_str(value: Any, default: str = "") -> str:
    if value is None:
        return default
    if isinstance(value, (datetime, date)):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip()
    return text or default


def _diameter_map(source: dict[str, Any] | None = None) -> dict[str, int]:
    source = source if isinstance(source, dict) else {}
    return {diameter: _safe_int(source.get(diameter), 0) for diameter in DIAMETERS}


def default_diameter_row() -> dict[str, Any]:
    return {
        "diametros": _diameter_map(),
        "oper": 0,
        "no_op": 0,
        "observaciones": "",
    }


def _normalize_diameter_row(source: Any) -> dict[str, Any]:
    row = default_diameter_row()
    if not isinstance(source, dict):
        return row
    diam_src = source.get("diametros")
    if isinstance(diam_src, dict):
        row["diametros"] = _diameter_map(diam_src)
    else:
        # Allow flat diameter keys on the row itself
        flat = {d: source.get(d) for d in DIAMETERS if d in source}
        if flat:
            row["diametros"] = _diameter_map(flat)
    row["oper"] = _safe_int(source.get("oper"), 0)
    row["no_op"] = _safe_int(source.get("no_op"), 0)
    row["observaciones"] = _safe_str(source.get("observaciones"), "")
    return row


def default_table(rows: list[str]) -> dict[str, dict[str, Any]]:
    return {key: default_diameter_row() for key in rows}


def _normalize_table(source: Any, rows: list[str]) -> dict[str, dict[str, Any]]:
    data = default_table(rows)
    if not isinstance(source, dict):
        return data
    for key in rows:
        data[key] = _normalize_diameter_row(source.get(key))
    return data


def default_header() -> dict[str, Any]:
    return {
        "photo_id": "",
        "estacion": "",
        "tipo": "ELEVADO",
        "volumen": 0,
        "ubicacion": "",
        "distrito": "",
        "fecha_ejecucion": "",
        "suministro": "",
        "sgio": "",
    }


def default_medidas() -> dict[str, str]:
    data = {field: "" for field in MEDIDA_FIELDS}
    data["observacion"] = ""
    return data


def _normalize_medidas(source: Any) -> dict[str, str]:
    medidas = default_medidas()
    if not isinstance(source, dict):
        return medidas
    for key in MEDIDA_FIELDS:
        medidas[key] = _safe_str(source.get(key), "")
    medidas["observacion"] = _safe_str(source.get("observacion") or source.get("observaciones"), "")
    return medidas


def default_metadata(informe_id: int) -> dict[str, Any]:
    return {"informe_id": int(informe_id)}


def create_empty_report(informe_id: int) -> dict[str, Any]:
    report_id = report_id_from_number(informe_id)
    return {
        "id": report_id,
        "metadata": default_metadata(informe_id),
        "header": default_header(),
        "valvulas": default_table(VALVULA_ROWS),
        "linea": default_table(LINEA_ROWS),
        "medidas": default_medidas(),
        "status": "draft",
        "last_modified": datetime.now().isoformat(),
    }


def sum_diameter_columns(table: dict[str, Any], rows: list[str]) -> dict[str, int]:
    totals = dict.fromkeys(DIAMETERS, 0)
    for row_key in rows:
        row = table.get(row_key) if isinstance(table, dict) else None
        if not isinstance(row, dict):
            continue
        diametros = row.get("diametros")
        if not isinstance(diametros, dict):
            continue
        for d in DIAMETERS:
            totals[d] += _safe_int(diametros.get(d), 0)
    return totals


def sum_oper_no_op(table: dict[str, Any], rows: list[str]) -> tuple[int, int]:
    oper = 0
    no_op = 0
    for row_key in rows:
        row = table.get(row_key) if isinstance(table, dict) else None
        if not isinstance(row, dict):
            continue
        oper += _safe_int(row.get("oper"), 0)
        no_op += _safe_int(row.get("no_op"), 0)
    return oper, no_op


class InformeV2:
    """Dictionary-based normalizer for Informes v2 IPC payloads."""

    @staticmethod
    def normalize(data: dict[str, Any] | None) -> dict[str, Any]:
        source = data if isinstance(data, dict) else {}
        metadata_raw = source.get("metadata")
        metadata_source = metadata_raw if isinstance(metadata_raw, dict) else {}
        informe_id = _safe_int(metadata_source.get("informe_id") or source.get("informe_id"), 1)
        report = create_empty_report(informe_id)
        report["id"] = _safe_str(source.get("id"), report_id_from_number(informe_id))

        metadata = deepcopy(report["metadata"])
        metadata.update({k: v for k, v in metadata_source.items() if v is not None})
        metadata["informe_id"] = _safe_int(metadata.get("informe_id"), informe_id)
        report["metadata"] = metadata

        header = deepcopy(report["header"])
        header_raw = source.get("header")
        header_source = header_raw if isinstance(header_raw, dict) else {}
        header.update({k: v for k, v in header_source.items() if v is not None})
        header["tipo"] = _safe_str(header.get("tipo"), "ELEVADO").upper()
        if header["tipo"] not in REPORT_TYPES:
            header["tipo"] = "ELEVADO"
        header["volumen"] = _safe_int(header.get("volumen"), 0)
        for key in ["photo_id", "estacion", "ubicacion", "distrito", "fecha_ejecucion", "suministro", "sgio"]:
            header[key] = _safe_str(header.get(key), "")
        # Keep photo_id empty when unset — do not invent a match key from estacion.
        # Importer may still default photo_id from estacion/suministro at import time.
        report["header"] = header

        report["valvulas"] = _normalize_table(source.get("valvulas"), VALVULA_ROWS)
        report["linea"] = _normalize_table(source.get("linea"), LINEA_ROWS)
        report["medidas"] = _normalize_medidas(source.get("medidas"))
        report["status"] = source.get("status") if source.get("status") in {"draft", "completed"} else "draft"
        report["last_modified"] = _safe_str(source.get("last_modified"), datetime.now().isoformat())
        return report


def next_informe_v2_number(reports: list[dict[str, Any]]) -> int:
    current = 0
    for report in reports:
        try:
            current = max(current, int(report.get("metadata", {}).get("informe_id", 0)))
        except (TypeError, ValueError):
            continue
    return current + 1
