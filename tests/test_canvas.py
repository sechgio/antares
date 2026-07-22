"""Tests for Canvas document store and schema."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.core.canvas.models import (
    create_empty_document,
    duplicate_document,
    next_copy_name,
    normalize_document,
)
from backend.core.canvas.store import CanvasStore
from backend.handlers import canvas as canvas_handlers


def test_create_empty_document_has_a4_frame() -> None:
    doc = create_empty_document(name="Demo")
    assert doc["version"] == 2
    assert doc["name"] == "Demo"
    assert doc["page"] == {"widthMm": 210, "heightMm": 297}
    assert len(doc["layers"]) == 1
    assert doc["layers"][0]["type"] == "frame"


def test_normalize_accepts_new_layer_types() -> None:
    raw = create_empty_document()
    raw["layers"].extend(
        [
            {
                "id": "g1",
                "type": "grid",
                "name": "Grid",
                "value": "",
                "cssVars": {
                    "--width": "100mm",
                    "--height": "100mm",
                    "--translate-x": "0mm",
                    "--translate-y": "0mm",
                },
                "meta": {"cols": 3, "rows": 3, "gapMm": 2},
            },
            {
                "id": "cb1",
                "type": "checkbox",
                "name": "Check",
                "value": "",
                "cssVars": {
                    "--width": "6mm",
                    "--height": "6mm",
                    "--translate-x": "10mm",
                    "--translate-y": "10mm",
                },
                "meta": {"key": "SERVICIO_A", "checked": True},
            },
            {
                "id": "ar1",
                "type": "arrow",
                "name": "Flecha",
                "value": "",
                "cssVars": {
                    "--width": "50mm",
                    "--height": "24mm",
                    "--translate-x": "10mm",
                    "--translate-y": "20mm",
                    "--background-color": "#000000",
                },
            },
            {
                "id": "pg1",
                "type": "polygon",
                "name": "Polígono",
                "value": "",
                "cssVars": {
                    "--width": "40mm",
                    "--height": "40mm",
                    "--translate-x": "10mm",
                    "--translate-y": "50mm",
                },
            },
            {
                "id": "st1",
                "type": "star",
                "name": "Estrella",
                "value": "",
                "cssVars": {
                    "--width": "40mm",
                    "--height": "40mm",
                    "--translate-x": "10mm",
                    "--translate-y": "100mm",
                },
            },
        ]
    )
    doc = normalize_document(raw)
    types = [layer["type"] for layer in doc["layers"]]
    assert "grid" in types
    assert "checkbox" in types
    assert "arrow" in types
    assert "polygon" in types
    assert "star" in types
    assert doc["version"] == 2
    assert doc["pages"]


def test_normalize_rejects_unknown_layer_types() -> None:
    raw = create_empty_document()
    raw["layers"].append(
        {
            "id": "bad",
            "type": "video",
            "name": "x",
            "value": "",
            "cssVars": {
                "--width": "10mm",
                "--height": "10mm",
                "--translate-x": "0mm",
                "--translate-y": "0mm",
            },
        }
    )
    raw["layers"].append(
        {
            "id": "ok",
            "type": "field",
            "name": "NIS",
            "value": "",
            "cssVars": {
                "--width": "20mm",
                "--height": "8mm",
                "--translate-x": "5mm",
                "--translate-y": "5mm",
            },
            "meta": {"key": "NIS", "fallback": "-"},
        }
    )
    doc = normalize_document(raw)
    types = [layer["type"] for layer in doc["layers"]]
    assert "video" not in types
    assert "field" in types
    field = next(layer for layer in doc["layers"] if layer["type"] == "field")
    assert field["meta"]["key"] == "NIS"


def test_store_crud_roundtrip(tmp_path: Path) -> None:
    store = CanvasStore(tmp_path)
    created = store.create(name="Panel A")
    assert created["id"]
    listed = store.list_documents()
    assert len(listed) == 1
    assert listed[0]["name"] == "Panel A"

    created["layers"].append(
        {
            "id": "t1",
            "type": "text",
            "name": "Titulo",
            "value": "Hola",
            "cssVars": {
                "--width": "40mm",
                "--height": "10mm",
                "--translate-x": "10mm",
                "--translate-y": "20mm",
                "--color": "#000",
            },
        }
    )
    saved = store.save(created)
    loaded = store.get(saved["id"])
    assert loaded is not None
    assert any(layer["type"] == "text" for layer in loaded["layers"])

    dup = store.duplicate(saved["id"])
    assert dup["id"] != saved["id"]
    assert len(store.list_documents()) == 2

    assert store.delete(saved["id"]) is True
    assert store.get(saved["id"]) is None


def test_duplicate_document_new_ids() -> None:
    source = create_empty_document(name="Orig")
    source["layers"].append(
        {
            "id": "layer-a",
            "type": "logo",
            "name": "Logo",
            "value": "",
            "cssVars": {
                "--width": "30mm",
                "--height": "15mm",
                "--translate-x": "5mm",
                "--translate-y": "5mm",
            },
            "meta": {"side": "left"},
        }
    )
    dup = duplicate_document(source)
    assert dup["id"] != source["id"]
    assert dup["name"] == "Orig (copia)"
    assert dup["layers"][0]["id"] != source["layers"][0]["id"]


def test_duplicate_document_remaps_parent_ids() -> None:
    source = create_empty_document(name="Src")
    gid = "group-old"
    cid = "child-old"
    source["layers"].append(
        {
            "id": gid,
            "type": "group",
            "name": "G",
            "value": "",
            "pageIndex": 0,
            "cssVars": {
                "--width": "10mm",
                "--height": "10mm",
                "--translate-x": "0mm",
                "--translate-y": "0mm",
            },
        }
    )
    source["layers"].append(
        {
            "id": cid,
            "type": "text",
            "name": "T",
            "value": "x",
            "parentId": gid,
            "pageIndex": 0,
            "cssVars": {
                "--width": "10mm",
                "--height": "10mm",
                "--translate-x": "0mm",
                "--translate-y": "0mm",
            },
        }
    )
    dup = duplicate_document(source)
    child = next(layer for layer in dup["layers"] if layer["type"] == "text")
    group = next(layer for layer in dup["layers"] if layer["type"] == "group")
    assert child["parentId"] == group["id"]
    assert child["parentId"] != gid


def test_next_copy_name_avoids_nested_suffixes() -> None:
    assert next_copy_name("Sin título") == "Sin título (copia)"
    assert next_copy_name("Sin título (copia)", {"Sin título (copia)"}) == "Sin título (copia 2)"
    assert next_copy_name(
        "Sin título (copia) (copia)",
        {"Sin título (copia)", "Sin título (copia 2)"},
    ) == "Sin título (copia 3)"


def test_store_duplicate_uses_unique_copy_names(tmp_path: Path) -> None:
    store = CanvasStore(tmp_path)
    original = store.create(name="Panel")
    first = store.duplicate(original["id"])
    second = store.duplicate(first["id"])
    third = store.duplicate(second["id"])
    names = {item["name"] for item in store.list_documents()}
    assert first["name"] == "Panel (copia)"
    assert second["name"] == "Panel (copia 2)"
    assert third["name"] == "Panel (copia 3)"
    assert names == {"Panel", "Panel (copia)", "Panel (copia 2)", "Panel (copia 3)"}


def test_path_traversal_rejected(tmp_path: Path) -> None:
    store = CanvasStore(tmp_path)
    with pytest.raises(ValueError):
        store.get("../secrets")


def test_handlers_with_injected_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = CanvasStore(tmp_path)

    def _get_store() -> CanvasStore:
        return store

    monkeypatch.setattr("backend.core.canvas.get_canvas_store", _get_store)

    assert canvas_handlers.canvas_list({}) == {"documents": []}
    created = canvas_handlers.canvas_create({"name": "X"})
    assert created["document"]["name"] == "X"
    listed = canvas_handlers.canvas_list({})
    assert len(listed["documents"]) == 1

    got = canvas_handlers.canvas_get({"id": created["document"]["id"]})
    assert got["document"]["id"] == created["document"]["id"]

    dup = canvas_handlers.canvas_duplicate({"id": created["document"]["id"]})
    assert dup["document"]["id"] != created["document"]["id"]

    canvas_handlers.canvas_delete({"id": created["document"]["id"]})
    with pytest.raises(ValueError):
        canvas_handlers.canvas_get({"id": created["document"]["id"]})
