from __future__ import annotations

from typing import Literal, TypedDict

from backend.core.report_types import ReportStatus, ReservoirType

InformeStatus = ReportStatus


class InformeDiameterRow(TypedDict):
    diametros: dict[str, int]
    oper: int
    no_op: int
    observaciones: str


class InformeMedidas(TypedDict):
    largo: str
    ancho: str
    diametro: str
    altura_rebose: str
    altura_total: str
    tirante_limpieza: str
    observacion: str


class InformeMetadata(TypedDict):
    informe_id: int


class InformeHeader(TypedDict):
    tipo: ReservoirType
    volumen: int
    photo_id: str
    estacion: str
    ubicacion: str
    distrito: str
    fecha_ejecucion: str
    suministro: str
    sgio: str
    contratista: str
    cod_infraestructura: str


class InspeccionRow(TypedDict):
    normal: bool
    critico: bool
    observaciones: str
    sugerencias: str


class Reservorios2Row(TypedDict):
    diametros: dict[str, int]
    oper: int
    no_op: int
    observaciones: str
    sugerencias: str


class Reservorios2Medidas(TypedDict):
    diametro: str
    diametro_interno: str
    altura_util: str
    altura_total: str
    etiqueta_diametro: str
    etiqueta_diametro_interno: str
    etiqueta_altura_util: str
    etiqueta_altura_total: str


class Reservorios2Totals(TypedDict):
    oper: int | None
    no_op: int | None


class Reservorios2Data(TypedDict):
    inspeccion: dict[str, InspeccionRow]
    valvulas: dict[str, Reservorios2Row]
    canastilla: dict[str, Reservorios2Row]
    valvulas_totales: Reservorios2Totals
    canastilla_totales: Reservorios2Totals
    medidas: Reservorios2Medidas


PlantillaId = Literal["clasica", "reservorios2"]


class InformeV2Document(TypedDict):
    id: str
    metadata: InformeMetadata
    plantilla: PlantillaId
    header: InformeHeader
    valvulas: dict[str, InformeDiameterRow]
    linea: dict[str, InformeDiameterRow]
    medidas: InformeMedidas
    reservorios2: Reservorios2Data
    status: InformeStatus
    last_modified: str
