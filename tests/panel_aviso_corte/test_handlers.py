"""Tests de handlers IPC para Panel Aviso de Corte."""

from __future__ import annotations

import base64

import pytest

from backend.handlers import panel_aviso_corte as handler_module


def _panel_payload() -> dict[str, object]:
    return {
        "cuadrante": "C001",
        "fecha_corte": "2025-06-15",
        "motivo": "Mantenimiento",
        "imagenes": [
            {"filename": "img1.png", "caption": "IMAGEN N°1: Calle 1", "position": 1},
        ],
        "source_row_index": 0,
    }


def test_render_pdf_forwards_export_mode(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_render_pdf(*, panels, logos, images, image_paths, export_mode, template_id=None):  # type: ignore[no-untyped-def]
        captured["export_mode"] = export_mode
        return b"%PDF", "panel.pdf"

    monkeypatch.setattr(handler_module, "render_pdf", fake_render_pdf)

    handler_module.panel_aviso_corte_render_pdf(
        {
            "panels": [_panel_payload()],
            "logos": {},
            "images": {},
            "image_paths": {},
            "format": "pdf",
            "export_mode": "skip_empty",
        },
    )

    assert captured["export_mode"] == "skip_empty"


def test_render_docx_forwards_export_mode(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_render_docx(*, panels, logos, images, image_paths, export_mode, template_id=None):  # type: ignore[no-untyped-def]
        captured["export_mode"] = export_mode
        return b"PK\x03\x04docx-bytes", "panel.docx"

    monkeypatch.setattr(handler_module, "render_docx", fake_render_docx)

    handler_module.panel_aviso_corte_render_pdf(
        {
            "panels": [_panel_payload()],
            "logos": {},
            "images": {},
            "image_paths": {},
            "format": "docx",
            "export_mode": "include_empty",
        },
    )

    assert captured["export_mode"] == "include_empty"


def test_render_pdf_forwards_template_id(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_render_pdf(*, panels, logos, images, image_paths, export_mode, template_id):  # type: ignore[no-untyped-def]
        captured["template_id"] = template_id
        return b"%PDF", "panel.pdf"

    monkeypatch.setattr(handler_module, "render_pdf", fake_render_pdf)

    handler_module.panel_aviso_corte_render_pdf(
        {
            "panels": [_panel_payload()],
            "logos": {},
            "images": {},
            "image_paths": {},
            "format": "pdf",
            "template_id": "aviso-corte-ad",
        },
    )

    assert captured["template_id"] == "aviso-corte-ad"


def test_render_pdf_prefers_disk_backed_images(
    monkeypatch,
    tmp_path,
) -> None:
    image_path = tmp_path / "img1.png"
    image_path.write_bytes(b"disk-image")
    fallback_b64 = base64.b64encode(b"fallback-image").decode("ascii")
    captured: dict[str, object] = {}

    def fake_render_pdf(*, panels, logos, images, image_paths, export_mode, template_id=None):  # type: ignore[no-untyped-def]
        captured["images"] = images
        captured["image_paths"] = image_paths
        return b"%PDF", "panel.pdf"

    monkeypatch.setattr(handler_module, "render_pdf", fake_render_pdf)

    handler_module.panel_aviso_corte_render_pdf(
        {
            "panels": [_panel_payload()],
            "logos": {},
            "images": {"img1.png": fallback_b64},
            "image_paths": {"img1.png": str(image_path)},
            "format": "pdf",
        },
    )

    assert captured["images"] == {"img1.png": fallback_b64}
    assert captured["image_paths"] == {"img1.png": str(image_path)}


def test_render_pdf_handles_null_images_and_logos(monkeypatch) -> None:
    """Regression: frontend may send `images: null` / `logos: null` / etc.

    The handler must NOT crash with AttributeError on `.items()` and should
    treat null values as empty mappings.
    """
    captured: dict[str, object] = {}

    def fake_render_pdf(*, panels, logos, images, image_paths, export_mode, template_id=None):  # type: ignore[no-untyped-def]
        captured["images"] = images
        captured["image_paths"] = image_paths
        captured["logos"] = logos
        return b"%PDF", "panel.pdf"

    monkeypatch.setattr(handler_module, "render_pdf", fake_render_pdf)

    result = handler_module.panel_aviso_corte_render_pdf(
        {
            "panels": [_panel_payload()],
            "logos": None,
            "images": None,
            "image_paths": None,
            "format": "pdf",
        },
    )

    assert captured["images"] == {}
    assert captured["image_paths"] == {}
    assert captured["logos"] == {"left": None, "right": None}
    # New keys for caller to disambiguate content type, plus backward-compat
    # `pdf_base64` alias must still be present.
    assert result["format"] == "pdf"
    assert result["mime_type"] == "application/pdf"
    assert result["pdf_base64"] == result["content_base64"]


def test_render_docx_response_advertises_docx_format(monkeypatch) -> None:
    """When format=docx the response must advertise the real content type
    via `format` / `mime_type`, while keeping `pdf_base64` as legacy alias.
    """
    def fake_render_docx(*, panels, logos, images, image_paths, export_mode, template_id=None):  # type: ignore[no-untyped-def]
        return b"PK\x03\x04docx-bytes", "panel.docx"

    monkeypatch.setattr(handler_module, "render_docx", fake_render_docx)

    result = handler_module.panel_aviso_corte_render_pdf(
        {
            "panels": [_panel_payload()],
            "logos": {},
            "images": {},
            "image_paths": {},
            "format": "docx",
        },
    )

    assert result["format"] == "docx"
    assert "wordprocessingml" in result["mime_type"]
    assert result["pdf_base64"] == result["content_base64"]
    assert result["filename"].endswith(".docx")


def test_render_pdf_writes_to_disk_when_output_path_given(monkeypatch, tmp_path) -> None:
    """When output_path is provided, the handler writes the file to disk
    and returns saved_path instead of base64-encoding the content.
    """
    def fake_render_pdf(*, panels, logos, images, image_paths, export_mode, template_id=None):  # type: ignore[no-untyped-def]
        return b"%PDF-1.4disk-content", "panel.pdf"

    monkeypatch.setattr(handler_module, "render_pdf", fake_render_pdf)

    output_file = tmp_path / "output.pdf"
    result = handler_module.panel_aviso_corte_render_pdf(
        {
            "panels": [_panel_payload()],
            "logos": {},
            "images": {},
            "image_paths": {},
            "format": "pdf",
            "output_path": str(output_file),
        },
    )

    assert result["saved_path"] == str(output_file)
    assert result["pdf_base64"] == ""
    assert result["content_base64"] == ""
    assert result["filename"] == "output.pdf"
    assert output_file.read_bytes() == b"%PDF-1.4disk-content"


def test_render_docx_writes_to_disk_when_output_path_given(monkeypatch, tmp_path) -> None:
    """When output_path is provided with format=docx, the handler writes
    the file to disk and returns saved_path instead of base64.
    """
    def fake_render_docx(*, panels, logos, images, image_paths, export_mode, template_id=None):  # type: ignore[no-untyped-def]
        return b"PK\x03\x04docx-disk-content", "panel.docx"

    monkeypatch.setattr(handler_module, "render_docx", fake_render_docx)

    output_file = tmp_path / "output.docx"
    result = handler_module.panel_aviso_corte_render_pdf(
        {
            "panels": [_panel_payload()],
            "logos": {},
            "images": {},
            "image_paths": {},
            "format": "docx",
            "output_path": str(output_file),
        },
    )

    assert result["saved_path"] == str(output_file)
    assert result["pdf_base64"] == ""
    assert result["content_base64"] == ""
    assert result["filename"] == "output.docx"
    assert output_file.read_bytes() == b"PK\x03\x04docx-disk-content"


@pytest.mark.parametrize("invalid_path", ["", "   "])
def test_template_rejects_empty_path(invalid_path: str) -> None:
    with pytest.raises(ValueError, match=r"path|Invalid path"):
        handler_module.panel_aviso_corte_template({"path": invalid_path})


def test_template_writes_excel_with_expected_columns(tmp_path) -> None:
    output_file = tmp_path / "plantilla"

    result = handler_module.panel_aviso_corte_template({"path": str(output_file)})

    saved = tmp_path / "plantilla.xlsx"
    assert result["path"] == str(saved)
    assert saved.is_file()
    assert saved.stat().st_size > 0

    try:
        import pandas as pd  # type: ignore
    except ImportError:
        pytest.skip("pandas no está instalado")

    df = pd.read_excel(saved, engine="openpyxl")
    assert list(df.columns) == [
        "ID",
        "DIRECCION",
        "FECHA DE CORTE",
        "CUADRANTE AFECTADO",
        "MOTIVO",
    ]
    assert len(df) == 4
