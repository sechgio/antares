"""Feature **Design**: generación de presentaciones con modelos propios.

Un Design es un documento de diapositivas con layout semántico y tema propio.
A diferencia del Canvas Document (capas en milímetros), aquí el modelo decide la
estructura y el tema; el render los traduce a HTML paginado.
"""

from __future__ import annotations

from backend.core.design.models import (
    DOCUMENT_VERSION,
    FONTS,
    LAYOUTS,
    PAGE_PRESETS,
    create_empty_document,
    normalize_document,
)
from backend.core.design.store import DesignStore, get_design_store

__all__ = [
    "DOCUMENT_VERSION",
    "FONTS",
    "LAYOUTS",
    "PAGE_PRESETS",
    "DesignStore",
    "create_empty_document",
    "get_design_store",
    "normalize_document",
]
