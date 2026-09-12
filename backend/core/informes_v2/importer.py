from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from backend.core.informes_v2.models import (
    DIAMETERS,
    LINEA_ROWS,
    VALVULA_ROWS,
    InformeV2,
    create_empty_report,
    report_id_from_number,
)
from backend.core.tabular_report_import import (
    import_reports,
    normalize_tabular_header,
    normalize_tabular_key,
    parse_csv_rows,
    parse_xlsx_rows,
)
from backend.utils.coercion import safe_int as _safe_int
from backend.utils.coercion import safe_str as _safe_str

COLUMN_MAPPING: dict[str, str] = {
    "nroinforme": "informe_id",
    "numeroinforme": "informe_id",
    "informeid": "informe_id",
    "informe": "informe_id",
    "item": "informe_id",
    "nro": "informe_id",
    "numero": "informe_id",
    "id": "photo_id",
    "codigoid": "photo_id",
    "photoid": "photo_id",
    "codigo": "photo_id",
    "codigoimagen": "photo_id",
    "estacion": "estacion",
    "estacionnombre": "estacion",
    "nombreestacion": "estacion",
    "reservorio": "estacion",
    "tipo": "tipo",
    "tipoestructura": "tipo",
    "tiporeservorio": "tipo",
    "volumen": "volumen",
    "volumenm3": "volumen",
    "capacidad": "volumen",
    "ubicacion": "ubicacion",
    "direccion": "ubicacion",
    "lugar": "ubicacion",
    "distrito": "distrito",
    "fecha": "fecha_ejecucion",
    "fechaejecucion": "fecha_ejecucion",
    "fechadeejecucion": "fecha_ejecucion",
    "suministro": "suministro",
    "nrosuministro": "suministro",
    "nis": "suministro",
    "sgio": "sgio",
    "nrosgio": "sgio",
    "observacion": "medidas_observacion",
    "observaciones": "medidas_observacion",
    "obs": "medidas_observacion",
}

VALVULA_ALIASES = {
    "conduccion": ("conduccion", "cond", "valvcond", "valvulasconduccion"),
    "impulsion": ("impulsion", "imp", "valvimp", "valvulasimpulsion"),
    "aduccion": ("aduccion", "aduc", "valvaduc", "valvulasaduccion"),
    "bypass": ("bypass", "pass", "by", "valvbypass", "valvulasbypass"),
    "purga": ("purga", "valvpurga", "valvulaspurga"),
}

LINEA_ALIASES = {
    "aduccion": ("lineaaduccion", "tuberiaaduccion", "aduccionlinea"),
    "alimentacion": ("alimentacion", "lineaalimentacion", "aliment"),
    "impulsion_rebombeo": (
        "impulsionrebombeo",
        "impulsionebombeo",
        "rebombeo",
        "lineaimpulsion",
        "linimpulsion",
        "impulsion",
    ),
    "rebose": ("rebose", "linearebose"),
    "purga": ("lineapurga", "purgalinea"),
}

for section, aliases in VALVULA_ALIASES.items():
    for alias in aliases:
        for diameter in DIAMETERS:
            COLUMN_MAPPING[f"{alias}{diameter}"] = f"valvulas_{section}_{diameter}"
            COLUMN_MAPPING[f"valv{alias}{diameter}"] = f"valvulas_{section}_{diameter}"
            COLUMN_MAPPING[f"valvulas{alias}{diameter}"] = f"valvulas_{section}_{diameter}"
        COLUMN_MAPPING[f"{alias}oper"] = f"valvulas_{section}_oper"
        COLUMN_MAPPING[f"{alias}noop"] = f"valvulas_{section}_no_op"
        COLUMN_MAPPING[f"{alias}nooper"] = f"valvulas_{section}_no_op"
        COLUMN_MAPPING[f"{alias}obs"] = f"valvulas_{section}_obs"
        COLUMN_MAPPING[f"obs{alias}"] = f"valvulas_{section}_obs"
        COLUMN_MAPPING[f"observaciones{alias}"] = f"valvulas_{section}_obs"

for section, aliases in LINEA_ALIASES.items():
    for alias in aliases:
        for diameter in DIAMETERS:
            COLUMN_MAPPING[f"{alias}{diameter}"] = f"linea_{section}_{diameter}"
            COLUMN_MAPPING[f"linea{alias}{diameter}"] = f"linea_{section}_{diameter}"
        COLUMN_MAPPING[f"{alias}oper"] = f"linea_{section}_oper"
        COLUMN_MAPPING[f"{alias}noop"] = f"linea_{section}_no_op"
        COLUMN_MAPPING[f"{alias}nooper"] = f"linea_{section}_no_op"
        COLUMN_MAPPING[f"{alias}obs"] = f"linea_{section}_obs"
        COLUMN_MAPPING[f"obs{alias}"] = f"linea_{section}_obs"

for section in VALVULA_ROWS:
    for diameter in DIAMETERS:
        COLUMN_MAPPING[f"valv{section}{diameter}"] = f"valvulas_{section}_{diameter}"
    COLUMN_MAPPING[f"valv{section}oper"] = f"valvulas_{section}_oper"
    COLUMN_MAPPING[f"valv{section}noop"] = f"valvulas_{section}_no_op"
    COLUMN_MAPPING[f"valv{section}obs"] = f"valvulas_{section}_obs"

for section in LINEA_ROWS:
    short = section.replace("_", "")
    for diameter in DIAMETERS:
        COLUMN_MAPPING[f"lin{short}{diameter}"] = f"linea_{section}_{diameter}"
        COLUMN_MAPPING[f"linea{short}{diameter}"] = f"linea_{section}_{diameter}"
    COLUMN_MAPPING[f"lin{short}oper"] = f"linea_{section}_oper"
    COLUMN_MAPPING[f"lin{short}noop"] = f"linea_{section}_no_op"
    COLUMN_MAPPING[f"lin{short}obs"] = f"linea_{section}_obs"

MEDIDA_ALIASES = {
    "largo": ("largo", "medidalargo", "longitud"),
    "ancho": ("ancho", "medidaancho", "width"),
    "diametro": ("diametro", "medidadiametro"),
    "altura_rebose": ("alturarebose", "medidaalturarebose", "rebosealtura"),
    "altura_total": ("alturatotal", "medidaalturatotal"),
    "tirante_limpieza": ("tirantelimpeza", "tirantelimpieza", "medidatirante"),
}

for field, aliases in MEDIDA_ALIASES.items():
    for alias in aliases:
        COLUMN_MAPPING[alias] = f"medidas_{field}"


def normalize_header_value(value: str) -> str:
    return normalize_tabular_header(value, strip_quotes=True)


def normalize_csv_key(value: str) -> str:
    return normalize_tabular_key(value, COLUMN_MAPPING, normalize_header_value)


def import_reports_from_bytes(filename: str, content: bytes) -> list[dict[str, Any]]:
    return import_reports(
        filename,
        content,
        parse_csv=parse_csv_file,
        parse_xlsx=parse_xlsx_file,
        transform_row=transform_flat_to_nested,
        to_int=_safe_int,
    )


def parse_csv_file(content: bytes) -> list[dict[str, Any]]:
    return parse_csv_rows(content, column_mapping=COLUMN_MAPPING, normalize_key=normalize_csv_key)


def parse_xlsx_file(content: bytes) -> list[dict[str, Any]]:
    return parse_xlsx_rows(
        content,
        column_mapping=COLUMN_MAPPING,
        normalize_header=normalize_header_value,
        normalize_key=normalize_csv_key,
    )


def transform_flat_to_nested(row: dict[str, Any], fallback_report_number: int = 1) -> dict[str, Any]:
    informe_id = _safe_int(row.get("informe_id"), 0)
    if informe_id <= 0:
        informe_id = fallback_report_number

    report = create_empty_report(informe_id)
    report["id"] = report_id_from_number(informe_id)

    photo_id = _safe_str(row.get("photo_id"))
    estacion = _safe_str(row.get("estacion"))
    suministro = _safe_str(row.get("suministro"))
    report["header"].update(
        {
            "photo_id": photo_id or estacion or suministro or report["id"],
            "estacion": estacion,
            "tipo": _safe_str(row.get("tipo"), "ELEVADO").upper(),
            "volumen": _safe_int(row.get("volumen"), 0),
            "ubicacion": _safe_str(row.get("ubicacion")),
            "distrito": _safe_str(row.get("distrito")),
            "fecha_ejecucion": _format_fecha(row.get("fecha_ejecucion")),
            "suministro": suministro,
            "sgio": _safe_str(row.get("sgio")),
        }
    )

    for section in VALVULA_ROWS:
        diametros = {d: _safe_int(row.get(f"valvulas_{section}_{d}"), 0) for d in DIAMETERS}
        report["valvulas"][section] = {
            "diametros": diametros,
            "oper": _safe_int(row.get(f"valvulas_{section}_oper"), 0),
            "no_op": _safe_int(row.get(f"valvulas_{section}_no_op"), 0),
            "observaciones": _safe_str(row.get(f"valvulas_{section}_obs")),
        }

    for section in LINEA_ROWS:
        diametros = {d: _safe_int(row.get(f"linea_{section}_{d}"), 0) for d in DIAMETERS}
        report["linea"][section] = {
            "diametros": diametros,
            "oper": _safe_int(row.get(f"linea_{section}_oper"), 0),
            "no_op": _safe_int(row.get(f"linea_{section}_no_op"), 0),
            "observaciones": _safe_str(row.get(f"linea_{section}_obs")),
        }

    report["medidas"].update(
        {
            "largo": _safe_str(row.get("medidas_largo")),
            "ancho": _safe_str(row.get("medidas_ancho")),
            "diametro": _safe_str(row.get("medidas_diametro")),
            "altura_rebose": _safe_str(row.get("medidas_altura_rebose")),
            "altura_total": _safe_str(row.get("medidas_altura_total")),
            "tirante_limpieza": _safe_str(row.get("medidas_tirante_limpieza")),
            "observacion": _safe_str(row.get("medidas_observacion")),
        }
    )
    report["last_modified"] = datetime.now().isoformat()
    return InformeV2.normalize(report)


def _format_fecha(value: Any) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, (datetime, date)):
        return value.strftime("%d/%m/%Y")
    text = str(value).strip()
    m = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})", text)
    if m:
        y, month, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return f"{d:02d}/{month:02d}/{y}"
    return text


TEMPLATE_HEADERS: list[str] = [
    "ID",
    "Informe",
    "Estacion",
    "Tipo",
    "Volumen",
    "Ubicacion",
    "Distrito",
    "Fecha Ejecucion",
    "Suministro",
    "SGIO",
]

for _section, label in [
    ("conduccion", "Valv Cond"),
    ("impulsion", "Valv Imp"),
    ("aduccion", "Valv Aduc"),
    ("bypass", "Valv Bypass"),
    ("purga", "Valv Purga"),
]:
    for diameter in DIAMETERS:
        TEMPLATE_HEADERS.append(f"{label} {diameter}")
    TEMPLATE_HEADERS.append(f"{label} Oper")
    TEMPLATE_HEADERS.append(f"{label} No Op")
    TEMPLATE_HEADERS.append(f"{label} Obs")

for _section, label in [
    ("aduccion", "Lin Aduccion"),
    ("alimentacion", "Lin Alimentacion"),
    ("impulsion_rebombeo", "Lin Impulsion"),
    ("rebose", "Lin Rebose"),
    ("purga", "Lin Purga"),
]:
    for diameter in DIAMETERS:
        TEMPLATE_HEADERS.append(f"{label} {diameter}")
    TEMPLATE_HEADERS.append(f"{label} Oper")
    TEMPLATE_HEADERS.append(f"{label} No Op")
    TEMPLATE_HEADERS.append(f"{label} Obs")

TEMPLATE_HEADERS.extend(
    [
        "Largo",
        "Ancho",
        "Diametro",
        "Altura Rebose",
        "Altura Total",
        "Tirante Limpieza",
        "Observacion",
    ]
)
