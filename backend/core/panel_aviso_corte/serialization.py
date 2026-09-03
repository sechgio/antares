
from __future__ import annotations

from typing import Any

from .errors import InvalidPanelError
from .models import Panel, PanelImageRef

_REQUIRED_PANEL_KEYS: tuple[str, ...] = (
    "cuadrante",
    "fecha_corte",
    "motivo",
    "imagenes",
)

_REQUIRED_IMAGE_KEYS: tuple[str, ...] = ("filename", "caption", "position")


def _serialize_image_ref(ref: PanelImageRef) -> dict[str, Any]:
    return {
        "filename": ref.filename,
        "caption": ref.caption,
        "position": ref.position,
    }


def serialize_panel(panel: Panel) -> dict[str, Any]:
    if not isinstance(panel, Panel):
        msg = (
            "serialize_panel: se esperaba Panel, se recibió "
            f"{type(panel).__name__}"
        )
        raise TypeError(
            msg,
        )
    return {
        "cuadrante": panel.cuadrante,
        "fecha_corte": panel.fecha_corte,
        "motivo": panel.motivo,
        "imagenes": [_serialize_image_ref(ref) for ref in panel.imagenes],
        "source_row_index": panel.source_row_index,
    }


def _deserialize_image_ref(raw: Any, index: int) -> PanelImageRef:
    if not isinstance(raw, dict):
        msg = (
            f"imagenes[{index}]: debe ser dict, se recibió "
            f"{type(raw).__name__}"
        )
        raise InvalidPanelError(
            msg,
        )
    for key in _REQUIRED_IMAGE_KEYS:
        if key not in raw:
            msg = f"imagenes[{index}].{key}: campo obligatorio ausente"
            raise InvalidPanelError(
                msg,
            )
    position = raw["position"]
    if not isinstance(position, int) or isinstance(position, bool):
        msg = (
            f"imagenes[{index}].position: debe ser int, se recibió "
            f"{type(position).__name__}"
        )
        raise InvalidPanelError(
            msg,
        )
    return PanelImageRef(
        filename=raw["filename"],
        caption=raw["caption"],
        position=position,
    )


def deserialize_panel(data: Any) -> Panel:
    if not isinstance(data, dict):
        msg = (
            "deserialize_panel: se esperaba dict, se recibió "
            f"{type(data).__name__}"
        )
        raise InvalidPanelError(
            msg,
        )

    for key in _REQUIRED_PANEL_KEYS:
        if key not in data:
            msg = f"{key}: campo obligatorio ausente en la carga serializada"
            raise InvalidPanelError(
                msg,
            )

    imagenes_raw = data["imagenes"]
    if not isinstance(imagenes_raw, (list, tuple)):
        msg = (
            "imagenes: debe ser list o tuple, se recibió "
            f"{type(imagenes_raw).__name__}"
        )
        raise InvalidPanelError(
            msg,
        )

    image_refs: tuple[PanelImageRef, ...] = tuple(
        _deserialize_image_ref(item, idx) for idx, item in enumerate(imagenes_raw)
    )

    source_row_index = data.get("source_row_index", None)

    return Panel(
        cuadrante=data["cuadrante"],
        fecha_corte=data["fecha_corte"],
        motivo=data["motivo"],
        imagenes=image_refs,
        source_row_index=source_row_index,
    )


__all__ = [
    "deserialize_panel",
    "serialize_panel",
]
