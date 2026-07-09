"""Serialización round-trip para Evidencia Volanteo."""

from __future__ import annotations

from typing import Any

from .layout import CUADRANTE_LABEL
from .models import EvidenciaDocument, EvidenciaPage, ImageRef


def _as_bool(value: Any, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "si", "sí", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return default


def deserialize_image_ref(raw: dict[str, Any]) -> ImageRef:
    return ImageRef(
        filename=str(raw.get("filename", "")),
        position=int(raw.get("position", 0)),
    )


def deserialize_page(raw: dict[str, Any], fallback_cuadrante: str = "") -> EvidenciaPage:
    images_raw = raw.get("images") or []
    images = tuple(deserialize_image_ref(item) for item in images_raw if isinstance(item, dict))
    cuadrante = str(raw.get("cuadrante", fallback_cuadrante)).strip()
    return EvidenciaPage(images=images, cuadrante=cuadrante)


def deserialize_document(raw: dict[str, Any]) -> EvidenciaDocument:
    pages_raw = raw.get("pages") or []
    fallback_cuadrante = str(raw.get("cuadrante", "")).strip()
    pages = tuple(
        deserialize_page(item, fallback_cuadrante=fallback_cuadrante)
        for item in pages_raw
        if isinstance(item, dict)
    )
    label_raw = raw.get("cuadrante_label")
    if label_raw is None:
        cuadrante_label = CUADRANTE_LABEL
    else:
        cuadrante_label = str(label_raw).strip() or CUADRANTE_LABEL
    return EvidenciaDocument(
        title=str(raw.get("title", "")).strip(),
        cuadrante=fallback_cuadrante,
        pages=pages,
        cuadrante_label=cuadrante_label,
        show_cuadrante_label=_as_bool(raw.get("show_cuadrante_label"), default=True),
    )
