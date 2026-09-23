from __future__ import annotations

import re
from collections.abc import Callable
from datetime import date, datetime
from typing import Any

from backend.core.informes_v2.models import (
    DIAMETERS,
    LINEA_ROWS,
    PLANTILLA_VALUES,
    VALVULA_ROWS,
    InformeV2,
    create_empty_report,
    report_id_from_number,
)
from backend.core.informes_v2.reservorios2_importer import (
    CLASICA_COLUMN_PREFIXES,
    R2_COLUMN_PREFIXES,
    InformePayload,
    extend_column_mappings,
    fill_reservorios2_report,
    is_tecnico_row,
    normalize_header_value,
)
from backend.core.informes_v2.reservorios2_importer import (
    R2_TEMPLATE_HEADERS as R2_TEMPLATE_HEADERS,
)
from backend.core.tabular_report_import import (
    ReportRow,
    import_reports,
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
    "plantilla": "plantilla",
    "contratista": "contratista",
    "codigoinfraestructura": "cod_infraestructura",
    "codinfraestructura": "cod_infraestructura",
    "codinfra": "cod_infraestructura",
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

R2_COLUMN_MAPPING = extend_column_mappings(COLUMN_MAPPING)


def normalize_csv_key(value: str, column_mapping: dict[str, str] = COLUMN_MAPPING) -> str:
    return normalize_tabular_key(value, column_mapping, normalize_header_value)


def import_reports_from_bytes(
    filename: str,
    content: bytes,
    plantilla: str | None = None,
) -> list[dict[str, Any]]:
    def parse_for_import(
        content_to_parse: bytes,
        parser: Callable[[bytes, dict[str, str]], list[ReportRow]],
    ) -> list[ReportRow]:
        if plantilla != "reservorios2":
            return parser(content_to_parse, COLUMN_MAPPING)
        classic_rows = parser(content_to_parse, COLUMN_MAPPING)
        if any(any(key.startswith("linea_") for key in row) for row in classic_rows):
            return classic_rows
        if not classic_rows:
            return parser(content_to_parse, R2_COLUMN_MAPPING)
        classic_rows.clear()
        r2_rows = parser(content_to_parse, R2_COLUMN_MAPPING)
        return r2_rows if r2_rows else parser(content_to_parse, COLUMN_MAPPING)

    def transform_row(row: ReportRow, fallback_report_number: int) -> InformePayload:
        report = transform_flat_to_nested(row, fallback_report_number, plantilla)
        # Las columnas del archivo identifican la plantilla: una plantilla Nueva
        # importada con el switch en Clásica (o al revés) nace con su formato.
        if any(key.startswith(R2_COLUMN_PREFIXES) for key in row) or is_tecnico_row(row):
            report["plantilla"] = "reservorios2"
        elif any(key.startswith(CLASICA_COLUMN_PREFIXES) for key in row):
            report["plantilla"] = "clasica"
        elif row.get("plantilla") in PLANTILLA_VALUES:
            report["plantilla"] = row["plantilla"]
        elif plantilla in PLANTILLA_VALUES:
            report["plantilla"] = plantilla
        return report

    return import_reports(
        filename,
        content,
        parse_csv=lambda data: parse_for_import(data, parse_csv_file),
        parse_xlsx=lambda data: parse_for_import(data, parse_xlsx_file),
        transform_row=transform_row,
        to_int=_safe_int,
    )


def parse_csv_file(
    content: bytes,
    column_mapping: dict[str, str] = COLUMN_MAPPING,
) -> list[ReportRow]:
    return parse_csv_rows(
        content,
        column_mapping=column_mapping,
        normalize_key=lambda value: normalize_csv_key(value, column_mapping),
    )


def parse_xlsx_file(
    content: bytes,
    column_mapping: dict[str, str] = COLUMN_MAPPING,
) -> list[ReportRow]:
    return parse_xlsx_rows(
        content,
        column_mapping=column_mapping,
        normalize_header=normalize_header_value,
        normalize_key=lambda value: normalize_csv_key(value, column_mapping),
    )


def transform_flat_to_nested(
    row: ReportRow,
    fallback_report_number: int = 1,
    plantilla_hint: str | None = None,
) -> InformePayload:
    informe_id = _safe_int(row.get("informe_id"), 0)
    if informe_id <= 0:
        informe_id = fallback_report_number

    report = create_empty_report(informe_id)
    report["id"] = report_id_from_number(informe_id)
    report["plantilla"] = _safe_str(row.get("plantilla"), report["plantilla"]).lower()

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
            "contratista": _safe_str(row.get("contratista")),
            "cod_infraestructura": _safe_str(row.get("cod_infraestructura")),
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

    fill_reservorios2_report(report, row, plantilla_hint)
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
