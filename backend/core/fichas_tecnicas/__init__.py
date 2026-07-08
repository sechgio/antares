"""Fichas Técnicas de Evaluación de Actividades — core package."""

from __future__ import annotations

from backend.core.fichas_tecnicas.database import FichasTecnicasDB, get_fichas_db
from backend.core.fichas_tecnicas.models import FichaTecnica, create_empty_ficha, ficha_id_from_number

__all__ = [
    "FichaTecnica",
    "FichasTecnicasDB",
    "create_empty_ficha",
    "ficha_id_from_number",
    "get_fichas_db",
]
