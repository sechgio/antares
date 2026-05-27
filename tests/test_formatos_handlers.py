import base64

import pytest

from backend.handlers.formatos import formatos_generate, formatos_upload


def test_formatos_upload_rejects_non_pdf_content() -> None:
    with pytest.raises(ValueError, match="no es un PDF válido"):
        formatos_upload(
            {
                "nombre": "malicioso",
                "filename": "malicioso.pdf",
                "content_b64": base64.b64encode(b"not-a-pdf").decode("ascii"),
            }
        )


def test_formatos_generate_writes_to_output_path_without_base64(monkeypatch, tmp_path) -> None:
    def fake_generate_pdf(format_id: str, desde: int, hasta: int) -> tuple[bytes, str]:
        assert format_id == "template-d"
        assert (desde, hasta) == (1, 500)
        return b"%PDF-large", "formato_d_0000001-0000500.pdf"

    monkeypatch.setattr("backend.core.formatos.generate_pdf", fake_generate_pdf)
    output_path = tmp_path / "salida.pdf"

    result = formatos_generate(
        {
            "format_id": "template-d",
            "desde": 1,
            "hasta": 500,
            "output_path": str(output_path),
        }
    )

    assert result == {"filename": "salida.pdf", "saved_path": str(output_path.resolve())}
    assert output_path.read_bytes() == b"%PDF-large"
    assert "pdf_base64" not in result
