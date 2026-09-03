import base64

import pytest

from backend.handlers.formatos import (
    formatos_generate,
    formatos_get_template,
    formatos_render_template_page,
    formatos_upload,
)


def test_formatos_upload_rejects_non_pdf_content() -> None:
    with pytest.raises(ValueError, match="no es un PDF válido"):
        formatos_upload(
            {
                "nombre": "malicioso",
                "filename": "malicioso.pdf",
                "content_b64": base64.b64encode(b"not-a-pdf").decode("ascii"),
            }
        )


def test_formatos_upload_rejects_filename_with_path_traversal() -> None:
    with pytest.raises(ValueError):
        formatos_upload(
            {
                "nombre": "malicioso",
                "filename": "../../malware.pdf",
                "content_b64": base64.b64encode(b"%PDF-evil").decode("ascii"),
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


def test_formatos_generate_large_persists_to_disk(monkeypatch) -> None:
    def fake_generate_pdf(format_id: str, desde: int, hasta: int) -> tuple[bytes, str]:
        return b"%PDF-huge-bytes", "formato_huge.pdf"

    monkeypatch.setattr("backend.core.formatos.generate_pdf", fake_generate_pdf)
    monkeypatch.setattr("backend.handlers.formatos._MAX_INLINE_PDF_BYTES", 10)

    result = formatos_generate(
        {
            "format_id": "template-d",
            "desde": 1,
            "hasta": 10,
        }
    )

    assert "saved_path" in result
    assert "pdf_base64" not in result
    assert result["filename"] == "formato_huge.pdf"
    from pathlib import Path
    out_file = Path(result["saved_path"])
    assert out_file.exists()
    assert out_file.read_bytes() == b"%PDF-huge-bytes"


def test_formatos_get_template_returns_pdf_base64(monkeypatch) -> None:
    def fake_get_template_pdf(fmt_id: str) -> tuple[bytes, str]:
        assert fmt_id == "template-d"
        return b"%PDF-1.4", "Formato D"

    monkeypatch.setattr("backend.core.formatos.get_template_pdf", fake_get_template_pdf)

    result = formatos_get_template({"format_id": "template-d"})

    assert result["filename"] == "Formato D"
    assert base64.b64decode(result["pdf_base64"]) == b"%PDF-1.4"


def test_formatos_render_template_page_returns_image(monkeypatch) -> None:
    def fake_render_template_page(fmt_id: str, page_num: int, max_width: int = 1200) -> dict:
        assert fmt_id == "template-d"
        assert page_num == 1
        assert max_width == 1200
        return {
            "image_base64": "aW1n",
            "page_width": 595.0,
            "page_height": 842.0,
            "mime_type": "image/png",
        }

    monkeypatch.setattr("backend.core.formatos.render_template_page", fake_render_template_page)

    result = formatos_render_template_page({"format_id": "template-d", "page_num": 1})

    assert result["image_base64"] == "aW1n"
    assert result["page_width"] == 595.0
    assert result["page_height"] == 842.0
    assert result["mime_type"] == "image/png"


def test_formatos_render_template_page_rejects_non_positive_page_num() -> None:
    with pytest.raises(ValueError, match="page_num"):
        formatos_render_template_page({"format_id": "template-d", "page_num": 0})


def test_formatos_render_template_page_rejects_non_numeric_page_num() -> None:
    with pytest.raises(ValueError, match="page_num"):
        formatos_render_template_page({"format_id": "template-d", "page_num": "abc"})


def test_formatos_render_template_page_rejects_oversized_max_width() -> None:
    with pytest.raises(ValueError, match="max_width"):
        formatos_render_template_page({"format_id": "template-d", "page_num": 1, "max_width": 99999})


def test_formatos_generate_rejects_non_numeric_desde() -> None:
    with pytest.raises(ValueError, match="desde"):
        formatos_generate({"format_id": "template-d", "desde": None, "hasta": 5})
