"""Serialización round-trip para Evidencia Volanteo."""

from __future__ import annotations

from typing import Any

from .models import EvidenciaDocument, EvidenciaPage, ImageRef


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
    return EvidenciaDocument(
        title=str(raw.get("title", "")).strip(),
        cuadrante=fallback_cuadrante,
        pages=pages,
    )
