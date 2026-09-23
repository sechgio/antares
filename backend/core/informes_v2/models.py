from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from typing import Any

from backend.core.informes_v2.types import (
    InspeccionRow,
    Reservorios2Data,
    Reservorios2Medidas,
    Reservorios2Row,
    Reservorios2Totals,
)
from backend.core.report_types import REPORT_STATUS_VALUES, RESERVOIR_TYPES
from backend.utils.coercion import safe_int as _safe_int
from backend.utils.coercion import safe_str as _safe_str

REPORT_TYPES = RESERVOIR_TYPES
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

PLANTILLA_VALUES = ["clasica", "reservorios2"]
DEFAULT_PLANTILLA = "clasica"

# Títulos fijos de la plantilla reservorios2. El frontend repite estos valores
# en types.ts y tests/test_schema_parity_extended.py fija que no diverjan.
R2_TITULO_LINEA1 = "Limpieza y Desinfección de Reservorios y Cisternas"
R2_TITULO_LINEA2 = "Centro de Servicio Sur"

R2_VALVULA_DIAMETERS = ["2", "3", "4", "6", "8", "10", "12"]
R2_VALVULA_LABELS = {
    "conduccion": "CONDUCCIÓN",
    "impulsion": "IMPULSIÓN",
    "aduccion": "ADUCCIÓN",
    "bypass": "BY PASS",
    "desague": "DESAGÜE",
}
R2_VALVULA_ROWS = list(R2_VALVULA_LABELS)
R2_CANASTILLA_DIAMETERS = ["2", "3", "4", "6", "8", "10", "14"]
R2_CANASTILLA_LABELS = {
    "aduccion": "ADUCCION",
    "succion": "SUCCION",
    "desague": "DESAGUE",
}
R2_CANASTILLA_ROWS = list(R2_CANASTILLA_LABELS)

# (clave, descripción, subdescripción) en el orden del formato Reservorios_2.
R2_INSPECCION_ITEMS = [
    ("caja_registro", "CAJA DE REGISTRO", ""),
    ("marco_tapa", "MARCO Y TAPA SANITARIA", ""),
    ("escalera_interior", "ESCALERA", "INTERIOR"),
    ("escalera_exterior", "ESCALERA", "EXTERIOR"),
    ("cuba_interior", "CUBA", "INTERIOR"),
    ("cuba_exterior", "CUBA", "EXTERIOR"),
    ("loza_fondo", "LOZA DE FONDO", ""),
    ("loza_techo_interior", "LOZA DE TECHO", "INTERIOR"),
    ("loza_techo_exterior", "LOZA DE TECHO", "EXTERIOR"),
    ("ducto", "DUCTO DE VENTILACIÓN", ""),
    ("cerco", "CERCO PERIMÉTRICO", ""),
    ("descarga", "DESAGÜE", ""),
]
R2_INSPECCION_ROWS = [key for key, _, _ in R2_INSPECCION_ITEMS]


def report_id_from_number(value: int) -> str:
    return f"IV2-{int(value):04d}"


def _diameter_map(
    source: dict[str, Any] | None = None,
    diameters: list[str] = DIAMETERS,
) -> dict[str, int]:
    source = source if isinstance(source, dict) else {}
    return {diameter: _safe_int(source.get(diameter), 0) for diameter in diameters}


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


def default_r2_row(diameters: list[str]) -> Reservorios2Row:
    return {
        "diametros": _diameter_map({}, diameters),
        "oper": 0,
        "no_op": 0,
        "observaciones": "",
        "sugerencias": "",
    }


def _normalize_r2_row(source: Any, diameters: list[str]) -> Reservorios2Row:
    row = default_r2_row(diameters)
    if not isinstance(source, dict):
        return row
    diam_src = source.get("diametros")
    if isinstance(diam_src, dict):
        row["diametros"] = _diameter_map(diam_src, diameters)
    else:
        flat = {d: source.get(d) for d in diameters if d in source}
        if flat:
            row["diametros"] = _diameter_map(flat, diameters)
    row["oper"] = _safe_int(source.get("oper"), 0)
    row["no_op"] = _safe_int(source.get("no_op"), 0)
    row["observaciones"] = _safe_str(source.get("observaciones"), "")
    row["sugerencias"] = _safe_str(source.get("sugerencias"), "")
    return row


def _normalize_r2_table(
    source: Any,
    rows: list[str],
    diameters: list[str],
) -> dict[str, Reservorios2Row]:
    data = {key: default_r2_row(diameters) for key in rows}
    if not isinstance(source, dict):
        return data
    for key in rows:
        data[key] = _normalize_r2_row(source.get(key), diameters)
    return data


def default_inspeccion_row() -> InspeccionRow:
    return {"normal": False, "critico": False, "observaciones": "", "sugerencias": ""}


def _normalize_inspeccion_row(source: Any) -> InspeccionRow:
    row = default_inspeccion_row()
    if not isinstance(source, dict):
        return row
    row["normal"] = bool(source.get("normal"))
    row["critico"] = bool(source.get("critico"))
    row["observaciones"] = _safe_str(source.get("observaciones"), "")
    row["sugerencias"] = _safe_str(source.get("sugerencias"), "")
    return row


def _r2_medidas(source: Any = None) -> Reservorios2Medidas:
    data = source if isinstance(source, dict) else {}
    return {
        "diametro": _safe_str(data.get("diametro"), ""),
        "diametro_interno": _safe_str(data.get("diametro_interno"), ""),
        "altura_util": _safe_str(data.get("altura_util"), ""),
        "altura_total": _safe_str(data.get("altura_total"), ""),
        "etiqueta_diametro": _safe_str(data.get("etiqueta_diametro"), "DIAMETRO"),
        "etiqueta_diametro_interno": _safe_str(
            data.get("etiqueta_diametro_interno"), "DIAMETRO INTERNO"
        ),
        "etiqueta_altura_util": _safe_str(data.get("etiqueta_altura_util"), "ALTURA UTIL"),
        "etiqueta_altura_total": _safe_str(data.get("etiqueta_altura_total"), "ALTURA TOTAL"),
    }


def _r2_totals(source: Any = None) -> Reservorios2Totals:
    data = source if isinstance(source, dict) else {}
    return {
        "oper": _safe_int(data.get("oper"), 0) if data.get("oper") is not None else None,
        "no_op": _safe_int(data.get("no_op"), 0) if data.get("no_op") is not None else None,
    }


def default_reservorios2() -> Reservorios2Data:
    return {
        "inspeccion": {key: default_inspeccion_row() for key in R2_INSPECCION_ROWS},
        "valvulas": {
            key: default_r2_row(R2_VALVULA_DIAMETERS) for key in R2_VALVULA_ROWS
        },
        "canastilla": {
            key: default_r2_row(R2_CANASTILLA_DIAMETERS) for key in R2_CANASTILLA_ROWS
        },
        "valvulas_totales": _r2_totals(),
        "canastilla_totales": _r2_totals(),
        "medidas": _r2_medidas(),
    }


def _normalize_reservorios2(source: Any) -> Reservorios2Data:
    data = default_reservorios2()
    if not isinstance(source, dict):
        return data
    inspeccion = source.get("inspeccion")
    if isinstance(inspeccion, dict):
        data["inspeccion"] = {
            key: _normalize_inspeccion_row(inspeccion.get(key)) for key in R2_INSPECCION_ROWS
        }
    data["valvulas"] = _normalize_r2_table(
        source.get("valvulas"), R2_VALVULA_ROWS, R2_VALVULA_DIAMETERS
    )
    data["canastilla"] = _normalize_r2_table(
        source.get("canastilla"), R2_CANASTILLA_ROWS, R2_CANASTILLA_DIAMETERS
    )
    data["valvulas_totales"] = _r2_totals(source.get("valvulas_totales"))
    data["canastilla_totales"] = _r2_totals(source.get("canastilla_totales"))
    medidas = source.get("medidas")
    if isinstance(medidas, dict):
        data["medidas"] = _r2_medidas(medidas)
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
        "contratista": "",
        "cod_infraestructura": "",
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
        "plantilla": DEFAULT_PLANTILLA,
        "header": default_header(),
        "valvulas": default_table(VALVULA_ROWS),
        "linea": default_table(LINEA_ROWS),
        "medidas": default_medidas(),
        "reservorios2": default_reservorios2(),
        "status": "draft",
        "last_modified": datetime.now().isoformat(),
    }


def sum_diameter_columns(
    table: dict[str, Any],
    rows: list[str],
    diameters: list[str] = DIAMETERS,
) -> dict[str, int]:
    totals = dict.fromkeys(diameters, 0)
    for row_key in rows:
        row = table.get(row_key) if isinstance(table, dict) else None
        if not isinstance(row, dict):
            continue
        diametros = row.get("diametros")
        if not isinstance(diametros, dict):
            continue
        for d in diameters:
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

    @staticmethod
    def normalize(data: dict[str, Any] | None) -> dict[str, Any]:
        source = data if isinstance(data, dict) else {}
        metadata_raw = source.get("metadata")
        metadata_source = metadata_raw if isinstance(metadata_raw, dict) else {}
        informe_id = _safe_int(metadata_source.get("informe_id") or source.get("informe_id"), 1)
        report = create_empty_report(informe_id)
        report["id"] = _safe_str(source.get("id"), report_id_from_number(informe_id))
        plantilla = _safe_str(source.get("plantilla"), DEFAULT_PLANTILLA)
        if plantilla not in PLANTILLA_VALUES:
            plantilla = DEFAULT_PLANTILLA

        metadata = deepcopy(report["metadata"])
        metadata.update({k: v for k, v in metadata_source.items() if v is not None})
        metadata["informe_id"] = _safe_int(metadata.get("informe_id"), informe_id)
        report["metadata"] = metadata
        report["plantilla"] = plantilla

        header = deepcopy(report["header"])
        header_raw = source.get("header")
        header_source = header_raw if isinstance(header_raw, dict) else {}
        header.update({k: v for k, v in header_source.items() if v is not None})
        header["tipo"] = _safe_str(header.get("tipo"), "ELEVADO").upper()
        if header["tipo"] not in REPORT_TYPES:
            header["tipo"] = "ELEVADO"
        header["volumen"] = _safe_int(header.get("volumen"), 0)
        for key in [
            "photo_id",
            "estacion",
            "ubicacion",
            "distrito",
            "fecha_ejecucion",
            "suministro",
            "sgio",
            "contratista",
            "cod_infraestructura",
        ]:
            header[key] = _safe_str(header.get(key), "")
        report["header"] = header

        report["valvulas"] = _normalize_table(source.get("valvulas"), VALVULA_ROWS)
        report["linea"] = _normalize_table(source.get("linea"), LINEA_ROWS)
        report["medidas"] = _normalize_medidas(source.get("medidas"))
        report["reservorios2"] = _normalize_reservorios2(source.get("reservorios2"))
        report["status"] = source.get("status") if source.get("status") in REPORT_STATUS_VALUES else "draft"
        report["last_modified"] = _safe_str(source.get("last_modified"), datetime.now().isoformat())
        return report
