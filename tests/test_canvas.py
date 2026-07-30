"""Tests for Canvas document store and schema."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.core.canvas import store as canvas_store_mod
from backend.core.canvas.models import (
    create_empty_document,
    duplicate_document,
    next_copy_name,
    normalize_document,
)
from backend.core.canvas.store import CanvasStore, migrate_legacy_canvas_documents
from backend.handlers import canvas as canvas_handlers


def test_create_empty_document_has_a4_frame() -> None:
    doc = create_empty_document(name="Demo")
    assert doc["version"] == 2
    assert doc["name"] == "Demo"
    assert doc["updatedAt"]
    assert doc["page"] == {"widthMm": 210, "heightMm": 297}
    assert len(doc["layers"]) == 1
    assert doc["layers"][0]["type"] == "frame"


def test_store_save_can_preserve_updated_at(tmp_path: Path) -> None:
    store = CanvasStore(tmp_path)
    created = store.create(name="Panel")
    stamped = {**created, "updatedAt": "2020-01-01T00:00:00.000Z", "name": "Renamed"}
    saved = store.save(stamped, touch=False)
    assert saved["updatedAt"] == "2020-01-01T00:00:00.000Z"
    assert saved["name"] == "Renamed"
    listed = store.list_documents()
    assert listed[0]["updatedAt"] == "2020-01-01T00:00:00.000Z"


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


def test_normalize_preserves_shared_styles_and_layer_links() -> None:
    raw = create_empty_document()
    raw["styles"] = [
        {
            "id": "style-1",
            "name": "Brand red",
            "kind": "color",
            "cssVars": {"--background-color": "#FF0000", "--fill-visible": "1"},
        }
    ]
    raw["layers"].append(
        {
            "id": "rect-1",
            "type": "rect",
            "name": "Box",
            "value": "",
            "fillStyleId": "style-1",
            "cssVars": {
                "--width": "40mm",
                "--height": "20mm",
                "--translate-x": "10mm",
                "--translate-y": "10mm",
                "--background-color": "#FF0000",
            },
        }
    )
    doc = normalize_document(raw)
    assert len(doc["styles"]) == 1
    assert doc["styles"][0]["id"] == "style-1"
    assert doc["styles"][0]["kind"] == "color"
    assert doc["styles"][0]["cssVars"] == {
        "--background-color": "#FF0000",
        "--fill-visible": "1",
    }
    assert "--width" not in doc["styles"][0]["cssVars"]
    linked = next(l for l in doc["layers"] if l["id"] == "rect-1")
    assert linked["fillStyleId"] == "style-1"


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


def test_normalize_preserves_editor_settings_and_guides() -> None:
    """Saving must keep showRulers/snap/guides — otherwise rulers reappear after Guardar."""
    raw = create_empty_document()
    raw["settings"] = {
        "imagesPerPage": 4,
        "showRulers": False,
        "snapToGrid": True,
        "gridSizeMm": 2.5,
        "gridRules": [{"whenImages": 4, "cols": 2, "rows": 2}],
    }
    raw["guides"] = [
        {"id": "g-x", "axis": "x", "posMm": 42},
        {"id": "g-y", "axis": "y", "posMm": 10.5},
        {"id": "bad", "axis": "z", "posMm": 1},
    ]
    doc = normalize_document(raw)
    assert doc["settings"]["showRulers"] is False
    assert doc["settings"]["snapToGrid"] is True
    assert doc["settings"]["gridSizeMm"] == 2.5
    assert doc["settings"]["imagesPerPage"] == 4
    assert doc["settings"]["gridRules"] == [{"whenImages": 4, "cols": 2, "rows": 2}]
    assert doc["guides"] == [
        {"id": "g-x", "axis": "x", "posMm": 42.0, "pageIndex": 0},
        {"id": "g-y", "axis": "y", "posMm": 10.5, "pageIndex": 0},
    ]


def test_normalize_preserves_grid_tracks() -> None:
    raw = create_empty_document()
    raw["layers"] = [
        {
            "id": "grid-1",
            "type": "grid",
            "name": "Grid",
            "cssVars": {
                "--width": "100mm",
                "--height": "100mm",
                "--translate-x": "0mm",
                "--translate-y": "0mm",
            },
            "meta": {
                "cols": 2,
                "rows": 2,
                "gapMm": 2.0,
                "colTracks": [1.5, 2.0],
                "rowTracks": [1.0, 3.0],
            },
        }
    ]
    doc = normalize_document(raw)
    grid = next(layer for layer in doc["layers"] if layer["id"] == "grid-1")
    assert grid["meta"]["colTracks"] == [1.5, 2.0]
    assert grid["meta"]["rowTracks"] == [1.0, 3.0]


def test_normalize_preserves_guide_page_index() -> None:
    raw = create_empty_document()
    raw["guides"] = [
        {"id": "g-p1", "axis": "x", "posMm": 20, "pageIndex": 1},
        {"id": "g-bad", "axis": "y", "posMm": 5, "pageIndex": -3},
    ]
    doc = normalize_document(raw)
    assert doc["guides"] == [
        {"id": "g-p1", "axis": "x", "posMm": 20.0, "pageIndex": 1},
        {"id": "g-bad", "axis": "y", "posMm": 5.0, "pageIndex": 0},
    ]


def test_default_docs_dir_uses_user_data(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    user_root = tmp_path / "AntaresUser"
    monkeypatch.setattr(
        canvas_store_mod,
        "user_data_path",
        lambda rel: user_root / rel,
    )
    monkeypatch.setattr(
        canvas_store_mod,
        "resource_path",
        lambda rel: tmp_path / "legacy_unused" / rel,
    )
    assert canvas_store_mod._default_docs_dir() == user_root / "canvas" / "documents"


def test_migrate_legacy_copies_missing_json_only(tmp_path: Path) -> None:
    legacy = tmp_path / "legacy"
    dest = tmp_path / "user"
    legacy.mkdir()
    dest.mkdir()
    (legacy / "a.json").write_text('{"id":"a","name":"A"}', encoding="utf-8")
    (legacy / "b.json").write_text('{"id":"b","name":"B"}', encoding="utf-8")
    (dest / "b.json").write_text('{"id":"b","name":"KEEP"}', encoding="utf-8")

    copied = migrate_legacy_canvas_documents(source=legacy, dest=dest)
    assert copied == 1
    assert (dest / "a.json").is_file()
    assert (dest / "b.json").read_text(encoding="utf-8") == '{"id":"b","name":"KEEP"}'


def test_store_migrates_legacy_when_using_default_dir(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    import json

    user_docs = tmp_path / "user" / "canvas" / "documents"
    legacy = tmp_path / "legacy" / "data" / "canvas" / "documents"
    legacy.mkdir(parents=True)
    doc = create_empty_document(name="Migrada")
    doc["id"] = "mig"
    (legacy / "mig.json").write_text(json.dumps(doc), encoding="utf-8")
    monkeypatch.setattr(canvas_store_mod, "user_data_path", lambda rel: tmp_path / "user" / rel)
    monkeypatch.setattr(
        canvas_store_mod,
        "resource_path",
        lambda rel: tmp_path / "legacy" / rel,
    )

    store = CanvasStore()
    assert store.docs_dir == user_docs
    loaded = store.get("mig")
    assert loaded is not None
    assert loaded["name"] == "Migrada"


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


def test_list_uses_stem_when_body_id_mismatches(tmp_path: Path) -> None:
    """list → get must work when filename stem ≠ document body id."""
    import json

    store = CanvasStore(tmp_path)
    body = create_empty_document(name="Mismatch")
    body["id"] = "inner-id"
    (tmp_path / "file-stem.json").write_text(json.dumps(body), encoding="utf-8")

    listed = store.list_documents()
    assert len(listed) == 1
    assert listed[0]["id"] == "file-stem"

    by_stem = store.get("file-stem")
    assert by_stem is not None
    assert by_stem["id"] == "file-stem"
    assert by_stem["name"] == "Mismatch"

    # Transitional fallback: older clients may still ask by body id.
    by_inner = store.get("inner-id")
    assert by_inner is not None
    assert by_inner["id"] == "file-stem"

    # Save under the repaired id consolidates onto the stem file.
    saved = store.save(by_stem)
    assert saved["id"] == "file-stem"
    assert (tmp_path / "file-stem.json").exists()


def test_corrupt_document_is_logged_and_skipped(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    """A corrupt JSON file is skipped from listings (no crash) and logged."""
    store = CanvasStore(tmp_path)
    # Write a valid doc first so the directory has one readable file.
    store.create(name="Good")
    # Drop a corrupt JSON file alongside it.
    (tmp_path / "broken.json").write_text("{not valid json", encoding="utf-8")

    with caplog.at_level("WARNING", logger="backend.core.canvas.store"):
        items = store.list_documents()

    # The good doc is listed; the corrupt one is skipped (no exception).
    assert [item["name"] for item in items] == ["Good"]
    # A warning was emitted naming the corrupt file.
    assert any("broken.json" in record.getMessage() for record in caplog.records)


def test_corrupt_document_get_returns_none_and_logs(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    """Reading a specific corrupt file returns None and logs a warning."""
    store = CanvasStore(tmp_path)
    (tmp_path / "broken.json").write_text("{not valid json", encoding="utf-8")

    with caplog.at_level("WARNING", logger="backend.core.canvas.store"):
        result = store.get("broken")

    assert result is None
    assert any("broken.json" in record.getMessage() for record in caplog.records)


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


def test_normalize_preserves_layer_meta_path() -> None:
    raw = create_empty_document()
    raw["layers"].append(
        {
            "id": "line-1",
            "type": "line",
            "name": "Linea Vector",
            "value": "",
            "cssVars": {
                "--width": "60mm",
                "--height": "10mm",
                "--translate-x": "5mm",
                "--translate-y": "5mm",
            },
            "meta": {
                "path": {
                    "points": [
                        {"x": 0.0, "y": 5.0, "hin": None, "hout": {"x": 2.0, "y": 0.0}},
                        {"x": 60.0, "y": 5.0, "hin": {"x": -2.0, "y": 0.0}, "hout": None},
                    ],
                    "closed": False,
                }
            },
        }
    )
    doc = normalize_document(raw)
    line_layer = next(layer for layer in doc["layers"] if layer["id"] == "line-1")
    assert "meta" in line_layer
    assert "path" in line_layer["meta"]
    path = line_layer["meta"]["path"]
    assert path["closed"] is False
    assert len(path["points"]) == 2
    assert path["points"][0]["x"] == 0.0
    assert path["points"][1]["hin"] == {"x": -2.0, "y": 0.0}

