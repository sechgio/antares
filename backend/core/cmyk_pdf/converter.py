"""PDF Post-Processor converter to transform PDF files to CMYK color space."""

from __future__ import annotations

import fitz


def convert_pdf_bytes_to_cmyk(pdf_bytes: bytes, dpi: int = 300) -> bytes:
    """Convert an existing PDF document to a print-ready CMYK PDF using PyMuPDF."""
    if not pdf_bytes or not pdf_bytes.startswith(b"%PDF"):
        raise ValueError("Contenido no es un archivo PDF válido")

    src_pdf = fitz.open(stream=pdf_bytes, filetype="pdf")
    out_pdf = fitz.open()

    for page in src_pdf:
        # Render high-resolution CMYK pixmap of the page
        pix = page.get_pixmap(colorspace=fitz.csCMYK, dpi=dpi)
        cmyk_page = out_pdf.new_page(width=page.rect.width, height=page.rect.height)
        cmyk_page.insert_image(page.rect, stream=pix.tobytes("jpeg"))

    res_bytes = out_pdf.tobytes(clean=True, deflate=True)
    src_pdf.close()
    out_pdf.close()
    return res_bytes
