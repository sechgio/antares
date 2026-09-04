"""Static contracts for Informe V2 documents."""

from __future__ import annotations

from typing import Literal, TypedDict

InformeStatus = Literal["draft", "completed"]
ReservoirType = Literal["ELEVADO", "ENTERRADO", "SEMIENTERRADO", "APOYADO", "CISTERNA"]


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


class InformeV2Document(TypedDict):
    id: str
    metadata: InformeMetadata
    header: InformeHeader
    valvulas: dict[str, InformeDiameterRow]
    linea: dict[str, InformeDiameterRow]
    medidas: InformeMedidas
    status: InformeStatus
    last_modified: str
