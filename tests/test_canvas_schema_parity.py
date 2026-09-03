
from __future__ import annotations

import json
import pathlib
from typing import get_args


def test_allowed_layer_types_match_typed_literal() -> None:
    from backend.core.canvas.models import ALLOWED_LAYER_TYPES
    from backend.core.canvas.types import CanvasLayerType

    literal_values = set(get_args(CanvasLayerType))
    assert frozenset(literal_values) == ALLOWED_LAYER_TYPES, (
        f"ALLOWED_LAYER_TYPES drift: models={sorted(ALLOWED_LAYER_TYPES)} "
        f"vs types Literal={sorted(literal_values)}"
    )


def test_heavy_methods_subset_of_shared_json() -> None:
    from backend.main import HEAVY_METHODS

    shared_path = pathlib.Path(__file__).resolve().parent.parent / "shared" / "long-running-methods.json"
    assert shared_path.exists(), f"shared file missing: {shared_path}"
    shared_methods = set(json.loads(shared_path.read_text(encoding="utf-8")))

    extra = HEAVY_METHODS - shared_methods
    allowed_extra = {"canvas_get", "canvas_save", "canvas_save_history", "canvas_export_cmyk_pdf"}
    unexpected = extra - allowed_extra
    assert not unexpected, f"HEAVY_METHODS has methods not in shared/long-running-methods.json: {sorted(unexpected)}"

    for required in ("db_import", "fichas_tecnicas_import_file", "informes_v2_render_html"):
        assert required in HEAVY_METHODS or required in shared_methods


def test_canvas_document_version_matches_frontend() -> None:
    import json

    from backend.core.canvas.models import A4_HEIGHT_MM, A4_WIDTH_MM, ALLOWED_LAYER_TYPES, DOCUMENT_VERSION

    shared_path = pathlib.Path(__file__).resolve().parent.parent / "shared" / "canvas-schema.json"
    assert shared_path.exists(), f"shared canvas schema missing: {shared_path}"
    schema = json.loads(shared_path.read_text(encoding="utf-8"))
    assert schema["documentVersion"] == DOCUMENT_VERSION
    assert DOCUMENT_VERSION == 2
    assert schema["a4"]["widthMm"] == A4_WIDTH_MM
    assert schema["a4"]["heightMm"] == A4_HEIGHT_MM
    assert frozenset(schema["layerTypes"]) == ALLOWED_LAYER_TYPES
    frontend_types = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "src" / "components" / "canvas" / "types.ts"
    if frontend_types.exists():
        text = frontend_types.read_text(encoding="utf-8")
        assert "shared/canvas-schema.json" in text, "frontend types.ts must import single source shared/canvas-schema.json"
        assert "DOCUMENT_VERSION = 2" not in text or "schema.documentVersion" in text
