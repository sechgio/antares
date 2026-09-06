from __future__ import annotations

from typing import Literal, TypedDict

FichaStatus = Literal["draft", "completed"]
FichaSatisfaccion = Literal["muy_satisfecho", "satisfecho", "regular", "insatisfecho", ""]


class FichaServicio(TypedDict):
    desinfeccion: bool
    limpieza_ambientes: bool
    limpieza_pozos_septicos: bool
    limpieza_reservorios: bool


class FichaTratamiento(TypedDict):
    pulverizado: bool
    atomizado: bool
    thermonebulizado: bool
    nebulizado_ulv: bool
    otros: str


class FichaProducto(TypedDict):
    producto: str
    composicion: str
    lote: str
    fecha_vencimiento: str
    unidad: str
    concentracion: str
    cantidad: str


class FichaObsRec(TypedDict):
    observacion_a: str
    observacion_b: str
    observacion_c: str
    recomendacion_a: str
    recomendacion_b: str
    recomendacion_c: str


class FichaDocument(TypedDict):
    id: str
    os_numero: str
    cliente: str
    fecha: str
    direccion: str
    distrito: str
    servicio: FichaServicio
    diagnostico_area: str
    condicion_sanitaria: str
    tratamiento: FichaTratamiento
    productos: list[FichaProducto]
    acciones_correctivas: str
    areas_tratadas: str
    personal_tecnico: list[str]
    hora_inicio: str
    hora_termino: str
    numero_certificado: str
    obs_rec: FichaObsRec
    satisfaccion: FichaSatisfaccion
    status: FichaStatus
    last_modified: str
