"""Round-trip attachment coverage for the native CMYK Canvas exporter."""

from __future__ import annotations

import base64
import json

import fitz

from backend.core.canvas.models import create_empty_document
from backend.core.cmyk_pdf import CanvasCmykRenderer


def test_cmyk_export_embeds_canvas_manifest() -> None:
    manifest = {
        "schema": "antares.canvas.pdf",
        "version": 1,
        "document": create_empty_document(name="Manifest"),
        "assets": [],
    }
    encoded = base64.b64encode(json.dumps(manifest).encode("utf-8")).decode("ascii")
    pdf_bytes = CanvasCmykRenderer(
        document=manifest["document"],
        canvas_manifest_b64=encoded,
    ).render()

    pdf = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        assert "antares-canvas-manifest.json" in pdf.embfile_names()
        attached = pdf.embfile_get("antares-canvas-manifest.json")
        raw = attached["content"] if isinstance(attached, dict) else attached
        assert json.loads(raw.decode("utf-8"))["schema"] == "antares.canvas.pdf"
    finally:
        pdf.close()
