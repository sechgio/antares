"""Tests de handlers IPC para Evidencia Volanteo."""

from __future__ import annotations

import pytest

from backend.core.evidencia_volanteo import RenderingError
from backend.handlers import evidencia_volanteo as handler_module


def _tiny_png() -> str:
    return (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )


def _document_payload() -> dict[str, object]:
    return {
        "title": "EVIDENCIAS FOTOGRAFICAS",
        "pages": [
            {
                "cuadrante": "CHORRILLOS",
                "images": [
                    {"filename": "img1.jpg", "position": 1},
                    {"filename": "img2.jpg", "position": 2},
                ],
            },
        ],
    }


def test_render_pdf_returns_base64(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_render_pdf(document, logos, images, image_paths=None):  # type: ignore[no-untyped-def]
        captured["title"] = document.title
        captured["pages"] = len(document.pages)
        return b"%PDF", "evidencia.pdf"

    monkeypatch.setattr(handler_module, "render_pdf", fake_render_pdf)

    resp = handler_module.evidencia_volanteo_render(
        {
            **_document_payload(),
            "logos": {"left_b64": _tiny_png()},
            "images": {"img1.jpg": _tiny_png()},
            "format": "pdf",
        },
    )

    assert resp["format"] == "pdf"
    assert resp["filename"] == "evidencia.pdf"
    assert captured["title"] == "EVIDENCIAS FOTOGRAFICAS"
    assert captured["pages"] == 1


def test_render_docx_writes_output_path(tmp_path, monkeypatch) -> None:
    out = tmp_path / "salida.docx"

    def fake_render_docx(document, logos, images, image_paths=None):  # type: ignore[no-untyped-def]
        return b"PK\x03\x04", "evidencia.docx"

    monkeypatch.setattr(handler_module, "render_docx", fake_render_docx)

    resp = handler_module.evidencia_volanteo_render(
        {
            **_document_payload(),
            "logos": {},
            "images": {},
            "format": "docx",
            "output_path": str(out),
        },
    )

    assert resp["saved_path"] == str(out)
    assert out.read_bytes() == b"PK\x03\x04"
    assert resp["content_base64"] == ""


def test_render_pdf_writes_output_path(tmp_path, monkeypatch) -> None:
    out = tmp_path / "salida.pdf"

    def fake_render_pdf(document, logos, images, image_paths=None):  # type: ignore[no-untyped-def]
        return b"%PDF-disk-test", "evidencia.pdf"

    monkeypatch.setattr(handler_module, "render_pdf", fake_render_pdf)

    resp = handler_module.evidencia_volanteo_render(
        {
            **_document_payload(),
            "logos": {},
            "images": {},
            "format": "pdf",
            "output_path": "antares-write_token_pdf_123",
            "_resolved_output_path": str(out),
            "_write_token": "antares-write_token_pdf_123",
        },
    )

    assert resp["saved_path"] == str(out)
    assert resp["filename"] == "salida.pdf"
    assert out.read_bytes() == b"%PDF-disk-test"
    assert resp["content_base64"] == ""
    assert resp["pdf_base64"] == ""


def test_render_pdf_uses_preview_html_when_provided(monkeypatch) -> None:
    called = {"html": False, "legacy": False}

    def fake_render_pdf_html(html):  # type: ignore[no-untyped-def]
        called["html"] = True
        assert "Vista previa" in html
        return b"%PDF", "preview.pdf"

    def fake_render_pdf(document, logos, images, image_paths=None):  # type: ignore[no-untyped-def]
        called["legacy"] = True
        return b"%PDF", "legacy.pdf"

    monkeypatch.setattr(handler_module, "render_pdf_html", fake_render_pdf_html)
    monkeypatch.setattr(handler_module, "render_pdf", fake_render_pdf)

    resp = handler_module.evidencia_volanteo_render(
        {
            **_document_payload(),
            "logos": {},
            "images": {},
            "format": "pdf",
            "html": "<html><body>Vista previa</body></html>",
        },
    )

    assert called["html"] is True
    assert called["legacy"] is False
    assert resp["filename"] == "preview.pdf"


def test_render_pdf_html_path_rejects_over_max_pages(monkeypatch) -> None:
    """Production PDF export sends html — cap must apply before WeasyPrint."""
    called = {"html": False}

    def fake_render_pdf_html(html):  # type: ignore[no-untyped-def]
        called["html"] = True
        return b"%PDF", "preview.pdf"

    monkeypatch.setattr(handler_module, "MAX_PAGES", 2)
    monkeypatch.setattr(handler_module, "render_pdf_html", fake_render_pdf_html)

    pages = [
        {"cuadrante": "A", "images": []},
        {"cuadrante": "B", "images": []},
        {"cuadrante": "C", "images": []},
    ]
    with pytest.raises(RenderingError, match="máximo de 2 páginas"):
        handler_module.evidencia_volanteo_render(
            {
                "title": "EVIDENCIAS FOTOGRAFICAS",
                "pages": pages,
                "logos": {},
                "images": {},
                "format": "pdf",
                "html": "<html><body>Vista previa</body></html>",
            },
        )

    assert called["html"] is False


def test_render_handles_null_images_and_logos(monkeypatch) -> None:
    def fake_render_pdf(document, logos, images, image_paths=None):  # type: ignore[no-untyped-def]
        assert logos == {"left": None, "right": None}
        assert images == {}
        assert image_paths == {}
        return b"%PDF", "evidencia.pdf"

    monkeypatch.setattr(handler_module, "render_pdf", fake_render_pdf)

    handler_module.evidencia_volanteo_render(
        {
            **_document_payload(),
            "logos": None,
            "images": None,
            "image_paths": None,
            "format": "pdf",
        },
    )
