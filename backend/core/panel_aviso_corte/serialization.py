"""Serialización round-trip de :class:`Panel` a/desde ``dict`` JSON-friendly.

Este módulo expone dos funciones:

* :func:`serialize_panel` convierte un :class:`Panel` a un ``dict`` plano
  (listas, strings, ints, ``None``), apto para ``json.dumps`` y para el
  transporte IPC JSON-RPC hacia el renderer.
* :func:`deserialize_panel` reconstruye un :class:`Panel` a partir de un
  ``dict`` con forma simétrica, validando campos obligatorios y tipos.

Diseño:

* No se usa :func:`dataclasses.asdict`: por defecto recurre dentro de las
  tuplas y produce tuples en la salida, lo que rompería el contrato
  JSON-friendly (``imagenes`` debe ser ``list``, no ``tuple``).
* Todas las validaciones fallan con :class:`InvalidPanelError`; los
  mensajes nombran siempre el campo problemático, para que los tests que
  usan ``pytest.raises(..., match="fieldname")`` puedan localizarlo.
* Los constructores ``PanelImageRef(...)`` y ``Panel(...)`` vuelven a
  aplicar I1..I4 en ``__post_init__``, así que esta capa sólo hace las
  validaciones que no haría el dataclass (presencia, forma del contenedor,
  tipos básicos).
"""

from __future__ import annotations

from typing import Any

from .errors import InvalidPanelError
from .models import Panel, PanelImageRef

# Conjunto inmutable con las claves obligatorias a nivel Panel.
_REQUIRED_PANEL_KEYS: tuple[str, ...] = (
    "cuadrante",
    "fecha_corte",
    "motivo",
    "imagenes",
)

# Conjunto inmutable con las claves obligatorias a nivel PanelImageRef.
_REQUIRED_IMAGE_KEYS: tuple[str, ...] = ("filename", "caption", "position")


# Serialización


def _serialize_image_ref(ref: PanelImageRef) -> dict[str, Any]:
    """Convierte un :class:`PanelImageRef` a un dict plano."""
    return {
        "filename": ref.filename,
        "caption": ref.caption,
        "position": ref.position,
    }


def serialize_panel(panel: Panel) -> dict[str, Any]:
    """Serializa un :class:`Panel` a un ``dict`` JSON-friendly.

    El ``dict`` devuelto:

    * Es de tipo ``dict`` exacto (no una subclase).
    * Contiene las claves ``cuadrante``, ``fecha_corte``, ``motivo``,
      ``imagenes`` (lista de dicts) y ``source_row_index`` (int o None).
    * No contiene tuplas ni instancias de dataclasses, por lo que puede
      pasarse directamente a :func:`json.dumps`.

    :raises TypeError: si ``panel`` no es una instancia de :class:`Panel`.
    """
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


# Deserialización


def _deserialize_image_ref(raw: Any, index: int) -> PanelImageRef:
    """Construye un :class:`PanelImageRef` desde un dict, validando forma y tipos.

    :param raw: item extraído de ``data["imagenes"]``.
    :param index: posición dentro de la lista ``imagenes`` (para mensajes).
    """
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
    # ``bool`` es subtipo de ``int`` en Python; rechazar explícitamente.
    if not isinstance(position, int) or isinstance(position, bool):
        msg = (
            f"imagenes[{index}].position: debe ser int, se recibió "
            f"{type(position).__name__}"
        )
        raise InvalidPanelError(
            msg,
        )
    # Delegamos el resto de invariantes (I2..I3) al constructor del dataclass.
    return PanelImageRef(
        filename=raw["filename"],
        caption=raw["caption"],
        position=position,
    )


def deserialize_panel(data: Any) -> Panel:
    """Reconstruye un :class:`Panel` a partir de un ``dict`` JSON-friendly.

    Contrato de validación:

    * ``data`` debe ser ``dict``.
    * Claves obligatorias: ``cuadrante``, ``fecha_corte``, ``motivo``,
      ``imagenes``. ``source_row_index`` es opcional (por defecto ``None``).
    * ``imagenes`` debe ser ``list`` o ``tuple``; cualquier otro tipo
      produce :class:`InvalidPanelError` con ``"imagenes"`` en el mensaje.
    * Cada item de ``imagenes`` debe ser ``dict`` con las claves
      ``filename``, ``caption``, ``position``; ``position`` debe ser un
      ``int`` (no ``bool``).
    * Las invariantes I1..I4 del dominio (formato de caption, fecha
      ISO-8601, rango de ``position``, posiciones únicas) las re-valida
      el constructor de :class:`Panel`.

    :raises InvalidPanelError: ante cualquier fallo de validación, con un
        mensaje que nombra el campo problemático.
    """
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

    # Delegamos tipado estricto de cuadrante/fecha_corte/motivo al constructor,
    # que ya aplica I4 y comprueba ``isinstance(..., str)``.
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
