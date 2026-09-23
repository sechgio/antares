from __future__ import annotations

from typing import Any

from backend.core.informes_v2.models import (
    R2_CANASTILLA_DIAMETERS,
    R2_CANASTILLA_ROWS,
    R2_INSPECCION_ROWS,
    R2_VALVULA_DIAMETERS,
    R2_VALVULA_ROWS,
)
from backend.core.tabular_report_import import ReportRow, normalize_tabular_header
from backend.core.technical_reports.importer import (
    COLUMN_MAPPING as TECHNICAL_COLUMN_MAPPING,
)
from backend.core.technical_reports.importer import (
    MESES,
    parse_check,
)
from backend.utils.coercion import safe_int as _safe_int
from backend.utils.coercion import safe_str as _safe_str

InformePayload = dict[str, Any]  # allowlist: normalized reports contain template-specific JSON fields

R2_INSPECCION_ALIASES = {
    "caja_registro": "cajaregistro",
    "marco_tapa": "marcoytapasanitaria",
    "escalera_interior": "escalerainterior",
    "escalera_exterior": "escaleraexterior",
    "cuba_interior": "cubainterior",
    "cuba_exterior": "cubaexterior",
    "loza_fondo": "lozafondo",
    "loza_techo_interior": "lozatechointerior",
    "loza_techo_exterior": "lozatechoexterior",
    "ducto": "ductoventilacion",
    "cerco": "cercoperimetrico",
    "descarga": "desague",
}

TECNICO_INSPECCION_FIELDS = {
    "caja_registro": ("caja_registro", "caja_registro"),
    "marco_tapa": ("marco_tapa", "marco_tapa"),
    "escalera_interior": ("escalera_interior", "escalera_int"),
    "escalera_exterior": ("escalera_exterior", "escalera_ext"),
    "cuba_interior": ("cuba_interior", "cuba_int"),
    "cuba_exterior": ("cuba_exterior", "cuba_ext"),
    "loza_fondo": ("loza_fondo", "loza_fondo"),
    "loza_techo_interior": ("loza_techo_interior", "loza_techo_int"),
    "loza_techo_exterior": ("loza_techo_exterior", "loza_techo_ext"),
    "ducto": ("ducto_ventilacion", "ducto"),
    "cerco": ("cerco_perimetrico", "cerco"),
    "descarga": ("descarga", "descarga"),
}

TECNICO_KEYS = {
    "cs",
    "dia",
    "mes",
    "anio",
    "valvulas_operativas",
    "valvulas_no_operativas",
    "canastillas_operativas",
    "canastillas_no_operativas",
    "medidas_etiqueta_diametro",
    "medidas_etiqueta_diametro_interno",
    "medidas_etiqueta_altura_util",
    "medidas_etiqueta_altura_total",
    *(estado_col for estado_col, _ in TECNICO_INSPECCION_FIELDS.values()),
    *(f"obs_{suf}" for _, suf in TECNICO_INSPECCION_FIELDS.values()),
    *(f"sug_{suf}" for _, suf in TECNICO_INSPECCION_FIELDS.values()),
}

R2_COLUMN_PREFIXES = ("r2_inspeccion_", "r2_valvulas_", "r2_canastilla_", "r2_medidas_")
CLASICA_COLUMN_PREFIXES = ("linea_",)


def normalize_header_value(value: str) -> str:
    return normalize_tabular_header(value, strip_quotes=True)


def extend_column_mappings(column_mapping: dict[str, str]) -> dict[str, str]:
    for section, alias in R2_INSPECCION_ALIASES.items():
        column_mapping[f"insp{alias}normal"] = f"r2_inspeccion_{section}_normal"
        column_mapping[f"insp{alias}critico"] = f"r2_inspeccion_{section}_critico"
        column_mapping[f"insp{alias}obs"] = f"r2_inspeccion_{section}_obs"
        column_mapping[f"insp{alias}observaciones"] = f"r2_inspeccion_{section}_obs"
        column_mapping[f"insp{alias}sug"] = f"r2_inspeccion_{section}_sug"
        column_mapping[f"insp{alias}sugerencias"] = f"r2_inspeccion_{section}_sug"

    for section in R2_VALVULA_ROWS:
        alias = section.replace("_", "")
        for diameter in R2_VALVULA_DIAMETERS:
            column_mapping[f"r2valv{alias}{diameter}"] = f"r2_valvulas_{section}_{diameter}"
        column_mapping[f"r2valv{alias}oper"] = f"r2_valvulas_{section}_oper"
        column_mapping[f"r2valv{alias}noop"] = f"r2_valvulas_{section}_no_op"
        column_mapping[f"r2valv{alias}obs"] = f"r2_valvulas_{section}_obs"
        column_mapping[f"r2valv{alias}sug"] = f"r2_valvulas_{section}_sug"

    for section in R2_CANASTILLA_ROWS:
        alias = section.replace("_", "")
        for diameter in R2_CANASTILLA_DIAMETERS:
            column_mapping[f"r2can{alias}{diameter}"] = f"r2_canastilla_{section}_{diameter}"
        column_mapping[f"r2can{alias}oper"] = f"r2_canastilla_{section}_oper"
        column_mapping[f"r2can{alias}noop"] = f"r2_canastilla_{section}_no_op"
        column_mapping[f"r2can{alias}obs"] = f"r2_canastilla_{section}_obs"
        column_mapping[f"r2can{alias}sug"] = f"r2_canastilla_{section}_sug"

    for field in ("diametro", "diametro_interno", "altura_util", "altura_total"):
        column_mapping[f"r2medida{field.replace('_', '')}"] = f"r2_medidas_{field}"

    for _section, (estado_col, suffix) in TECNICO_INSPECCION_FIELDS.items():
        column_mapping[estado_col.replace("_", "")] = estado_col
        column_mapping[f"obs{suffix.replace('_', '')}"] = f"obs_{suffix}"
        column_mapping[f"sug{suffix.replace('_', '')}"] = f"sug_{suffix}"

    for section in R2_VALVULA_ROWS:
        for diameter in R2_VALVULA_DIAMETERS:
            column_mapping.setdefault(f"valvulas{section}{diameter}", f"valvulas_{section}_{diameter}")
        column_mapping[f"valvulas{section}oper"] = f"valvulas_{section}_oper"
        column_mapping[f"valvulas{section}noop"] = f"valvulas_{section}_no_op"
        column_mapping[f"obsvalvulas{section}"] = f"obs_valvulas_{section}"
        column_mapping[f"sugvalvulas{section}"] = f"sug_valvulas_{section}"

    for section in R2_CANASTILLA_ROWS:
        for diameter in R2_CANASTILLA_DIAMETERS:
            column_mapping[f"canastillas{section}{diameter}"] = f"canastillas_{section}_{diameter}"
            column_mapping[f"canastilla{section}{diameter}"] = f"canastillas_{section}_{diameter}"
        column_mapping[f"canastillas{section}oper"] = f"canastillas_{section}_oper"
        column_mapping[f"canastillas{section}noop"] = f"canastillas_{section}_no_op"
        column_mapping[f"obscanastillas{section}"] = f"obs_canastillas_{section}"
        column_mapping[f"sugcanastillas{section}"] = f"sug_canastillas_{section}"

    column_mapping.update(
        {
            "dia": "dia",
            "mes": "mes",
            "ano": "anio",
            "anio": "anio",
            "cs": "cs",
            "valvulasoperativas": "valvulas_operativas",
            "valvulasnooperativas": "valvulas_no_operativas",
            "canastillasoperativas": "canastillas_operativas",
            "canastillasnooperativas": "canastillas_no_operativas",
            "medidasdiametro": "medidas_diametro",
            "medidasdiametrointerno": "medidas_diametro_interno",
            "medidasalturautil": "medidas_altura_util",
            "medidasalturatotal": "medidas_altura_total",
            "medidasetiquetadiametro": "medidas_etiqueta_diametro",
            "medidasetiquetadiametrointerno": "medidas_etiqueta_diametro_interno",
            "medidasetiquetaalturautil": "medidas_etiqueta_altura_util",
            "medidasetiquetaalturatotal": "medidas_etiqueta_altura_total",
        }
    )

    r2_column_mapping = dict(column_mapping)
    r2_column_mapping.update(
        {
            alias: "cod_infraestructura" if target == "codigo_infraestructura" else target
            for alias, target in TECHNICAL_COLUMN_MAPPING.items()
        }
    )
    r2_column_mapping.update({"photoid": "photo_id", "codigoimagen": "photo_id"})
    return r2_column_mapping


def is_tecnico_row(row: ReportRow) -> bool:
    return any(key in TECNICO_KEYS or key.startswith("canastillas_") for key in row)


def fill_reservorios2_report(
    report: InformePayload,
    row: ReportRow,
    plantilla_hint: str | None,
) -> None:
    reservorios2 = report["reservorios2"]
    for section in R2_INSPECCION_ROWS:
        reservorios2["inspeccion"][section] = {
            "normal": _safe_bool(row.get(f"r2_inspeccion_{section}_normal")),
            "critico": _safe_bool(row.get(f"r2_inspeccion_{section}_critico")),
            "observaciones": _safe_str(row.get(f"r2_inspeccion_{section}_obs")),
            "sugerencias": _safe_str(row.get(f"r2_inspeccion_{section}_sug")),
        }

    for section in R2_VALVULA_ROWS:
        reservorios2["valvulas"][section] = {
            "diametros": {
                diameter: _safe_int(row.get(f"r2_valvulas_{section}_{diameter}"), 0)
                for diameter in R2_VALVULA_DIAMETERS
            },
            "oper": _safe_int(row.get(f"r2_valvulas_{section}_oper"), 0),
            "no_op": _safe_int(row.get(f"r2_valvulas_{section}_no_op"), 0),
            "observaciones": _safe_str(row.get(f"r2_valvulas_{section}_obs")),
            "sugerencias": _safe_str(row.get(f"r2_valvulas_{section}_sug")),
        }

    for section in R2_CANASTILLA_ROWS:
        reservorios2["canastilla"][section] = {
            "diametros": {
                diameter: _safe_int(row.get(f"r2_canastilla_{section}_{diameter}"), 0)
                for diameter in R2_CANASTILLA_DIAMETERS
            },
            "oper": _safe_int(row.get(f"r2_canastilla_{section}_oper"), 0),
            "no_op": _safe_int(row.get(f"r2_canastilla_{section}_no_op"), 0),
            "observaciones": _safe_str(row.get(f"r2_canastilla_{section}_obs")),
            "sugerencias": _safe_str(row.get(f"r2_canastilla_{section}_sug")),
        }

    reservorios2["medidas"].update(
        {
            "diametro": _safe_str(row.get("r2_medidas_diametro")),
            "diametro_interno": _safe_str(row.get("r2_medidas_diametro_interno")),
            "altura_util": _safe_str(row.get("r2_medidas_altura_util")),
            "altura_total": _safe_str(row.get("r2_medidas_altura_total")),
        }
    )
    if is_tecnico_row(row) or plantilla_hint == "reservorios2" or row.get("plantilla") == "reservorios2":
        _fill_tecnico(report, row)


def _fill_tecnico(report: InformePayload, row: ReportRow) -> None:
    header = report["header"]
    if not header["estacion"]:
        header["estacion"] = header["cod_infraestructura"]
    if not header["distrito"]:
        header["distrito"] = header["ubicacion"]
    if not header["fecha_ejecucion"]:
        header["fecha_ejecucion"] = _fecha_tecnico(row)
    if not _safe_str(row.get("photo_id")):
        header["photo_id"] = header["estacion"] or header["photo_id"]

    reservorios2 = report["reservorios2"]
    for section in R2_INSPECCION_ROWS:
        estado_col, text_suffix = TECNICO_INSPECCION_FIELDS[section]
        inspeccion = reservorios2["inspeccion"][section]
        if estado_col in row:
            estado = parse_check(row[estado_col])
            inspeccion["normal"] = estado == "normal"
            inspeccion["critico"] = estado == "critico"
        for field, suffix in (("observaciones", f"obs_{text_suffix}"), ("sugerencias", f"sug_{text_suffix}")):
            if suffix in row:
                inspeccion[field] = _safe_str(row[suffix])

    for section in R2_VALVULA_ROWS:
        valvula = reservorios2["valvulas"][section]
        for diameter in R2_VALVULA_DIAMETERS:
            key = f"valvulas_{section}_{diameter}"
            if key in row:
                valvula["diametros"][diameter] = _safe_int(row[key], 0)
        for field, key in (
            ("oper", f"valvulas_{section}_oper"),
            ("no_op", f"valvulas_{section}_no_op"),
        ):
            if key in row:
                valvula[field] = _safe_int(row[key], 0)
        for field, key in (
            ("observaciones", f"obs_valvulas_{section}"),
            ("sugerencias", f"sug_valvulas_{section}"),
        ):
            if key in row:
                valvula[field] = _safe_str(row[key])

    for section in R2_CANASTILLA_ROWS:
        canastilla = reservorios2["canastilla"][section]
        for diameter in R2_CANASTILLA_DIAMETERS:
            key = f"canastillas_{section}_{diameter}"
            if key in row:
                canastilla["diametros"][diameter] = _safe_int(row[key], 0)
        for field, key in (
            ("oper", f"canastillas_{section}_oper"),
            ("no_op", f"canastillas_{section}_no_op"),
        ):
            if key in row:
                canastilla[field] = _safe_int(row[key], 0)
        for field, key in (
            ("observaciones", f"obs_canastillas_{section}"),
            ("sugerencias", f"sug_canastillas_{section}"),
        ):
            if key in row:
                canastilla[field] = _safe_str(row[key])

    if not any(row["oper"] or row["no_op"] for row in reservorios2["valvulas"].values()):
        reservorios2["valvulas_totales"] = {
            "oper": _optional_int(row.get("valvulas_operativas")),
            "no_op": _optional_int(row.get("valvulas_no_operativas")),
        }
    if not any(row["oper"] or row["no_op"] for row in reservorios2["canastilla"].values()):
        reservorios2["canastilla_totales"] = {
            "oper": _optional_int(row.get("canastillas_operativas")),
            "no_op": _optional_int(row.get("canastillas_no_operativas")),
        }
    medidas = reservorios2["medidas"]
    for field, key in (
        ("diametro", "medidas_diametro"),
        ("diametro_interno", "medidas_diametro_interno"),
        ("altura_util", "medidas_altura_util"),
        ("altura_total", "medidas_altura_total"),
    ):
        if key in row:
            medidas[field] = _safe_str(row[key])
    for field, key, default in (
        ("etiqueta_diametro", "medidas_etiqueta_diametro", "DIAMETRO"),
        ("etiqueta_diametro_interno", "medidas_etiqueta_diametro_interno", "DIAMETRO INTERNO"),
        ("etiqueta_altura_util", "medidas_etiqueta_altura_util", "ALTURA UTIL"),
        ("etiqueta_altura_total", "medidas_etiqueta_altura_total", "ALTURA TOTAL"),
    ):
        if key in row:
            medidas[field] = _safe_str(row[key], default)


_MES_NUMERO = {normalize_header_value(name): numero for numero, name in MESES.items()}


def _resolve_mes_numero(value: Any) -> int:
    if value is None or str(value).strip() == "":
        return 0
    numero = _safe_int(value, 0)
    if 1 <= numero <= 12:
        return numero
    return _MES_NUMERO.get(normalize_header_value(str(value)), 0)


def _fecha_tecnico(row: ReportRow) -> str:
    dia = _safe_int(row.get("dia"), 0)
    mes = _resolve_mes_numero(row.get("mes"))
    anio = _safe_int(row.get("anio"), 0)
    if dia <= 0 or mes <= 0 or anio <= 0:
        return ""
    return f"{dia:02d}/{mes:02d}/{anio}"


def _safe_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return normalize_header_value(str(value or "")) in {
        "1",
        "critico",
        "normal",
        "s",
        "si",
        "true",
        "verdadero",
        "x",
    }


def _optional_int(value: Any) -> int | None:
    if value is None or str(value).strip() == "":
        return None
    return _safe_int(value, 0)


R2_TEMPLATE_HEADERS: list[str] = [
    "informe_id",
    "photo_id",
    "dia",
    "mes",
    "anio",
    "codigo_infraestructura",
    "ubicacion",
    "suministro",
    "tipo",
    "volumen",
]

R2_TEMPLATE_HEADERS.extend(estado_col for estado_col, _ in TECNICO_INSPECCION_FIELDS.values())

for _section in R2_INSPECCION_ROWS:
    _suffix = TECNICO_INSPECCION_FIELDS[_section][1]
    R2_TEMPLATE_HEADERS.extend([f"obs_{_suffix}", f"sug_{_suffix}"])

for _section in R2_VALVULA_ROWS:
    R2_TEMPLATE_HEADERS.extend(f"valvulas_{_section}_{diameter}" for diameter in R2_VALVULA_DIAMETERS)
    R2_TEMPLATE_HEADERS.extend([f"valvulas_{_section}_oper", f"valvulas_{_section}_no_op"])
R2_TEMPLATE_HEADERS.extend(["valvulas_operativas", "valvulas_no_operativas"])
for _section in R2_VALVULA_ROWS:
    R2_TEMPLATE_HEADERS.extend([f"obs_valvulas_{_section}", f"sug_valvulas_{_section}"])

for _section in R2_CANASTILLA_ROWS:
    R2_TEMPLATE_HEADERS.extend(f"canastillas_{_section}_{diameter}" for diameter in R2_CANASTILLA_DIAMETERS)
    R2_TEMPLATE_HEADERS.extend([f"canastillas_{_section}_oper", f"canastillas_{_section}_no_op"])
R2_TEMPLATE_HEADERS.extend(["canastillas_operativas", "canastillas_no_operativas"])
for _section in R2_CANASTILLA_ROWS:
    R2_TEMPLATE_HEADERS.extend([f"obs_canastillas_{_section}", f"sug_canastillas_{_section}"])

R2_TEMPLATE_HEADERS.extend(
    [
        "medidas_diametro",
        "medidas_diametro_interno",
        "medidas_altura_util",
        "medidas_altura_total",
        "medidas_etiqueta_diametro",
        "medidas_etiqueta_diametro_interno",
        "medidas_etiqueta_altura_util",
        "medidas_etiqueta_altura_total",
    ]
)
