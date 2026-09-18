from __future__ import annotations

import json
import pathlib
import re
from typing import get_args, get_type_hints

ROOT = pathlib.Path(__file__).resolve().parent.parent


def _shared_json(name: str) -> dict:
    return json.loads((ROOT / "shared" / name).read_text(encoding="utf-8"))


def test_allowed_layer_types_match_typed_literal() -> None:
    from backend.core.canvas.models import ALLOWED_LAYER_TYPES
    from backend.core.canvas.types import CanvasLayerType

    literal_values = set(get_args(CanvasLayerType))
    assert frozenset(literal_values) == ALLOWED_LAYER_TYPES, (
        f"ALLOWED_LAYER_TYPES drift: models={sorted(ALLOWED_LAYER_TYPES)} "
        f"vs types Literal={sorted(literal_values)}"
    )


def test_heavy_methods_match_ipc_catalog() -> None:
    from backend.main import HEAVY_METHODS

    catalog = _shared_json("ipc-method-catalog.json")
    catalog_heavy = {
        name for name, entry in catalog["methods"].items() if entry.get("lane") == "heavy"
    }

    assert catalog_heavy == HEAVY_METHODS, (
        f"HEAVY_METHODS drift vs catalog: "
        f"extra={sorted(HEAVY_METHODS - catalog_heavy)} "
        f"missing={sorted(catalog_heavy - HEAVY_METHODS)}"
    )

    for required in ("db_import", "fichas_tecnicas_import_file", "informes_v2_render_html"):
        assert required in HEAVY_METHODS


def test_canvas_document_version_matches_frontend() -> None:
    from backend.core.canvas.models import A4_HEIGHT_MM, A4_WIDTH_MM, ALLOWED_LAYER_TYPES, DOCUMENT_VERSION

    schema = _shared_json("canvas-schema.json")
    assert schema["documentVersion"] == DOCUMENT_VERSION
    assert DOCUMENT_VERSION == 2
    assert schema["a4"]["widthMm"] == A4_WIDTH_MM
    assert schema["a4"]["heightMm"] == A4_HEIGHT_MM
    assert frozenset(schema["layerTypes"]) == ALLOWED_LAYER_TYPES
    frontend_types = ROOT / "frontend" / "src" / "components" / "canvas" / "types.ts"
    if frontend_types.exists():
        text = frontend_types.read_text(encoding="utf-8")
        assert "shared/canvas-schema.json" in text, "frontend types.ts must import single source shared/canvas-schema.json"
        assert "DOCUMENT_VERSION = 2" not in text or "schema.documentVersion" in text


def test_frontend_layer_type_union_matches_schema() -> None:
    text = (ROOT / "frontend" / "src" / "components" / "canvas" / "types.ts").read_text(
        encoding="utf-8"
    )
    match = re.search(r"export type CanvasLayerType\s*=\s*([^;]+);", text)
    assert match, "CanvasLayerType union not found in frontend types.ts"
    union_members = set(re.findall(r"'([^']+)'", match.group(1)))
    schema_types = frozenset(_shared_json("canvas-schema.json")["layerTypes"])
    assert union_members == schema_types, (
        f"frontend CanvasLayerType drift: extra={sorted(union_members - schema_types)} "
        f"missing={sorted(schema_types - union_members)}"
    )


def test_canvas_guide_axes_match_shared_contract() -> None:
    from backend.core.canvas.types import CanvasGuide

    schema = _shared_json("canvas-schema.json")
    typed_axes = frozenset(get_args(get_type_hints(CanvasGuide)["axis"]))

    assert frozenset(schema["guideAxes"]) == typed_axes


def test_canvas_normalization_corpus_matches_python() -> None:
    from backend.core.canvas.models import normalize_document

    corpus = _shared_json("canvas-normalization-cases.json")
    for case in corpus["guideCases"]:
        normalized = normalize_document(case["document"])
        assert normalized["guides"] == case["expectedGuides"], case["name"]
