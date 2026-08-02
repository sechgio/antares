"""Evidencia Volanteo — panel fotográfico sin Excel."""

from .errors import EvidenciaVolanteoError, RenderingError
from .models import MAX_IMAGES_PER_PAGE, MAX_PAGES, EvidenciaDocument, EvidenciaPage, ImageRef
from .rendering import render_docx, render_pdf, render_pdf_html
from .serialization import deserialize_document

__all__ = [
    "MAX_IMAGES_PER_PAGE",
    "MAX_PAGES",
    "EvidenciaDocument",
    "EvidenciaPage",
    "EvidenciaVolanteoError",
    "ImageRef",
    "RenderingError",
    "deserialize_document",
    "render_docx",
    "render_pdf",
    "render_pdf_html",
]
