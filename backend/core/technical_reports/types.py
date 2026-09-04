"""Static contracts for technical reports."""

from __future__ import annotations

from typing import Literal, TypedDict

TechnicalStatus = Literal["draft", "completed"]
CheckState = Literal["normal", "critico", "unchecked"]
ReservoirType = Literal["ELEVADO", "ENTERRADO", "SEMIENTERRADO", "APOYADO", "CISTERNA"]


class TechnicalMetadata(TypedDict):
    informe_id: int
    dia: int
    mes: str
    anio: int
    pagina: str


class TechnicalHeader(TypedDict):
    cs: str
    contratista: str
    sgio: str
    sgio_label: str
    titulo_linea1: str
    titulo_linea2: str
    codigo_infraestructura: str
    ubicacion: str
    suministro: str
    tipo: ReservoirType
    volumen: int


class TechnicalInspection(TypedDict):
    caja_registro: CheckState
    marco_tapa: CheckState
    escalera_interior: CheckState
    escalera_exterior: CheckState
    cuba_interior: CheckState
    cuba_exterior: CheckState
    loza_fondo: CheckState
    loza_techo_interior: CheckState
    loza_techo_exterior: CheckState
    ducto_ventilacion: CheckState
    cerco_perimetrico: CheckState
    descarga: CheckState
    observaciones_caja_registro: str
    sugerencias_caja_registro: str
    observaciones_marco_tapa: str
    sugerencias_marco_tapa: str
    observaciones_escalera_int: str
    sugerencias_escalera_int: str
    observaciones_escalera_ext: str
    sugerencias_escalera_ext: str
    observaciones_cuba_int: str
    sugerencias_cuba_int: str
    observaciones_cuba_ext: str
    sugerencias_cuba_ext: str
    observaciones_loza_fondo: str
    sugerencias_loza_fondo: str
    observaciones_loza_techo_int: str
    sugerencias_loza_techo_int: str
    observaciones_loza_techo_ext: str
    sugerencias_loza_techo_ext: str
    observaciones_ducto: str
    sugerencias_ducto: str
    observaciones_cerco: str
    sugerencias_cerco: str
    observaciones_descarga: str
    sugerencias_descarga: str


TechnicalDiameterMap = dict[str, int]


class TechnicalValvulas(TypedDict):
    diametros: TechnicalDiameterMap
    impulsion: TechnicalDiameterMap
    aduccion: TechnicalDiameterMap
    bypass: TechnicalDiameterMap
    desague: TechnicalDiameterMap
    operativas: int
    no_operativas: int
    observaciones_conduccion: str
    sugerencias_conduccion: str
    observaciones_impulsion: str
    sugerencias_impulsion: str
    observaciones_aduccion: str
    sugerencias_aduccion: str
    observaciones_bypass: str
    sugerencias_bypass: str
    observaciones_desague: str
    sugerencias_desague: str


class TechnicalCanastillas(TypedDict):
    diametros: TechnicalDiameterMap
    aduccion: TechnicalDiameterMap
    succion: TechnicalDiameterMap
    desague: TechnicalDiameterMap
    operativas: int
    no_operativas: int
    observaciones_aduccion: str
    sugerencias_aduccion: str
    observaciones_succion: str
    sugerencias_succion: str
    observaciones_desague: str
    sugerencias_desague: str


class TechnicalMedidas(TypedDict):
    diametro: str
    diametro_interno: str
    altura_util: str
    altura_total: str
    etiqueta_diametro: str
    etiqueta_diametro_interno: str


class TechnicalReportDocument(TypedDict):
    id: str
    metadata: TechnicalMetadata
    header: TechnicalHeader
    inspeccion: TechnicalInspection
    valvulas: TechnicalValvulas
    canastillas: TechnicalCanastillas
    medidas: TechnicalMedidas
    observaciones: str
    sugerencias: str
    status: TechnicalStatus
    last_modified: str
