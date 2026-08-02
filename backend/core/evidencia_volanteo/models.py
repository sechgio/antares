"""Modelos canónicos para Evidencia Volanteo."""

from __future__ import annotations

from dataclasses import dataclass, field

from .layout import CUADRANTE_LABEL

MAX_IMAGES_PER_PAGE = 6
MAX_PAGES = 1000
MAX_LOGO_BYTES = 5 * 1024 * 1024
MAX_IMAGE_BYTES = 15 * 1024 * 1024


@dataclass(frozen=True)
class ImageRef:
    filename: str
    position: int


@dataclass(frozen=True)
class EvidenciaPage:
    images: tuple[ImageRef, ...]
    cuadrante: str = ""


@dataclass(frozen=True)
class EvidenciaDocument:
    title: str
    cuadrante: str
    pages: tuple[EvidenciaPage, ...]
    cuadrante_label: str = field(default=CUADRANTE_LABEL)
    show_cuadrante_label: bool = True
