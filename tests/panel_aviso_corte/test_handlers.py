"""Tests de handlers IPC para Panel Aviso de Corte."""

from __future__ import annotations

import base64

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


def test_render_pdf_prefers_disk_backed_images(
    monkeypatch,
    tmp_path,
) -> None:
    image_path = tmp_path / "img1.png"
    image_path.write_bytes(b"disk-image")
    fallback_b64 = base64.b64encode(b"fallback-image").decode("ascii")
    captured: dict[str, object] = {}

    def fake_render_pdf(*, panels, logos, images, image_paths, export_mode):  # type: ignore[no-untyped-def]
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

    def fake_render_pdf(*, panels, logos, images, image_paths, export_mode):  # type: ignore[no-untyped-def]
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
    def fake_render_docx(*, panels, logos, images, image_paths, export_mode):  # type: ignore[no-untyped-def]
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
