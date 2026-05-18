import base64

import pytest

from backend.handlers.formatos import formatos_upload


def test_formatos_upload_rejects_non_pdf_content() -> None:
    with pytest.raises(ValueError, match="no es un PDF válido"):
        formatos_upload(
            {
                "nombre": "malicioso",
                "filename": "malicioso.pdf",
                "content_b64": base64.b64encode(b"not-a-pdf").decode("ascii"),
            }
        )
