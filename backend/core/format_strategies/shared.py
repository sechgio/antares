from __future__ import annotations

from pypdf import PdfWriter
from pypdf._page import PageObject
from pypdf.generic import NameObject


def _escape_pdf_text(value: str) -> str:
    safe = value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    for src, dst in [
        ("\xe1", "a"), ("\xe9", "e"), ("\xed", "i"), ("\xf3", "o"), ("\xfa", "u"),
        ("\xc1", "A"), ("\xc9", "E"), ("\xcd", "I"), ("\xd3", "O"), ("\xda", "U"),
        ("\xf1", "n"), ("\xd1", "N"), ("\xfc", "u"), ("\xdc", "U"),
    ]:
        safe = safe.replace(src, dst)
    return safe


def _clone_page_shallow(writer: PdfWriter, base_page: PageObject) -> PageObject:
    """Registra una página nueva en ``writer`` compartiendo el grafo de ``base_page``.

    ``raw_get`` conserva las referencias indirectas (contenido, recursos) para que
    pypdf no duplique el cuerpo de la plantilla: solo el dict de página es privado.
    """
    new_page = PageObject(pdf=writer)
    for key in base_page:
        new_page[NameObject(key)] = base_page.raw_get(key)
    return writer._add_page(new_page, len(writer.pages))
