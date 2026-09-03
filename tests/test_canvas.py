
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
from backend.core.exceptions import NotFoundError, ValidationError
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
    linked = next(layer for layer in doc["layers"] if layer["id"] == "rect-1")
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


def test_normalize_meta_preserves_valid_auto_layout() -> None:
    raw = create_empty_document()
    raw["layers"].append(
        {
            "id": "grp",
            "type": "group",
            "name": "Stack",
            "value": "",
            "pageIndex": 0,
            "meta": {
                "autoLayout": {
                    "direction": "row",
                    "gapMm": 4,
                    "padMm": 2.5,
                    "alignMain": "center",
                    "alignCross": "stretch",
                    "sizing": "hug",
                },
                "constraintH": "end",
                "constraintV": "scale",
            },
            "cssVars": {
                "--width": "100mm",
                "--height": "40mm",
                "--translate-x": "0mm",
                "--translate-y": "0mm",
            },
        }
    )
    doc = normalize_document(raw)
    grp = next(layer for layer in doc["layers"] if layer["id"] == "grp")
    assert grp["meta"]["autoLayout"] == {
        "direction": "row",
        "gapMm": 4.0,
        "padMm": 2.5,
        "alignMain": "center",
        "alignCross": "stretch",
        "sizing": "hug",
    }
    assert grp["meta"]["constraintH"] == "end"
    assert grp["meta"]["constraintV"] == "scale"


def test_normalize_meta_omits_invalid_auto_layout() -> None:
    raw = create_empty_document()
    raw["layers"].append(
        {
            "id": "bad",
            "type": "group",
            "name": "Bad",
            "value": "",
            "pageIndex": 0,
            "meta": {
                "autoLayout": {
                    "direction": "diagonal",
                    "gapMm": -1,
                    "padMm": 2,
                    "alignMain": "center",
                    "alignCross": "start",
                    "sizing": "hug",
                },
                "constraintH": "diagonal",
                "key": "keep-me",
            },
            "cssVars": {
                "--width": "40mm",
                "--height": "10mm",
                "--translate-x": "0mm",
                "--translate-y": "0mm",
            },
        }
    )
    doc = normalize_document(raw)
    bad = next(layer for layer in doc["layers"] if layer["id"] == "bad")
    assert "autoLayout" not in bad["meta"]
    assert "constraintH" not in bad["meta"]
    assert bad["meta"]["key"] == "keep-me"


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

    by_inner = store.get("inner-id")
    assert by_inner is not None
    assert by_inner["id"] == "file-stem"

    saved = store.save(by_stem)
    assert saved["id"] == "file-stem"
    assert (tmp_path / "file-stem.json").exists()


def test_corrupt_document_is_logged_and_skipped(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    store = CanvasStore(tmp_path)
    store.create(name="Good")
    (tmp_path / "broken.json").write_text("{not valid json", encoding="utf-8")

    with caplog.at_level("WARNING", logger="backend.core.canvas.store"):
        items = store.list_documents()

    assert [item["name"] for item in items] == ["Good"]
    assert any("broken.json" in record.getMessage() for record in caplog.records)


def test_list_large_document_uses_extract_doc_meta(tmp_path: Path) -> None:
    import json

    store = CanvasStore(tmp_path)
    body = create_empty_document(name="Large Doc")
    body["id"] = "inner-large"
    body["updatedAt"] = "2026-08-02T12:00:00.000Z"
    body["layers"].append(
        {
            "id": "img1",
            "type": "image",
            "name": "Pad",
            "value": f"data:image/jpeg;base64,{'A' * 80_000}",
            "pageIndex": 0,
            "cssVars": {},
        },
    )
    path = tmp_path / "large-stem.json"
    path.write_text(json.dumps(body), encoding="utf-8")
    assert path.stat().st_size >= 65536

    listed = store.list_documents()
    assert len(listed) == 1
    assert listed[0]["id"] == "large-stem"
    assert listed[0]["name"] == "Large Doc"
    assert listed[0]["updatedAt"] == "2026-08-02T12:00:00.000Z"

    by_inner = store.get("inner-large")
    assert by_inner is not None
    assert by_inner["id"] == "large-stem"
    assert by_inner["name"] == "Large Doc"


def test_corrupt_document_get_returns_none_and_logs(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
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
    with pytest.raises(NotFoundError, match="Documento no encontrado"):
        canvas_handlers.canvas_get({"id": created["document"]["id"]})

    with pytest.raises(NotFoundError, match="Documento no encontrado"):
        canvas_handlers.canvas_delete({"id": "missing-id"})

    with pytest.raises(ValidationError, match="document debe ser un objeto"):
        canvas_handlers.canvas_save({"document": "not-an-object"})


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


def test_normalize_clamps_out_of_range_page_index() -> None:
    raw = create_empty_document()
    raw["pages"] = [{"id": "p1", "name": "Página 1"}, {"id": "p2", "name": "Página 2"}]
    raw["layers"].append(
        {
            "id": "ghost",
            "type": "text",
            "name": "Ghost",
            "value": "x",
            "pageIndex": 999,
            "cssVars": {
                "--width": "40mm",
                "--height": "10mm",
                "--translate-x": "10mm",
                "--translate-y": "10mm",
            },
        }
    )
    doc = normalize_document(raw)
    ghost = next(layer for layer in doc["layers"] if layer["id"] == "ghost")
    assert ghost["pageIndex"] == 1


def test_normalize_clamps_negative_page_index_to_zero() -> None:
    doc = create_empty_document(name="Neg")
    doc["layers"][0]["pageIndex"] = -5
    normalized = normalize_document(doc)
    assert normalized["layers"][0]["pageIndex"] == 0


def test_normalize_meta_bool_strings() -> None:
    raw = create_empty_document()
    raw["layers"].append(
        {
            "id": "cb-false",
            "type": "checkbox",
            "name": "Off",
            "value": "",
            "pageIndex": 0,
            "meta": {"checked": "false"},
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
            "id": "cb-true",
            "type": "checkbox",
            "name": "On",
            "value": "",
            "pageIndex": 0,
            "meta": {"checked": "true"},
            "cssVars": {
                "--width": "10mm",
                "--height": "10mm",
                "--translate-x": "20mm",
                "--translate-y": "0mm",
            },
        }
    )
    raw["layers"].append(
        {
            "id": "cb-bool",
            "type": "checkbox",
            "name": "Bool",
            "value": "",
            "pageIndex": 0,
            "meta": {"checked": True},
            "cssVars": {
                "--width": "10mm",
                "--height": "10mm",
                "--translate-x": "40mm",
                "--translate-y": "0mm",
            },
        }
    )
    raw["layers"].append(
        {
            "id": "slot",
            "type": "imageSlot",
            "name": "Foto",
            "value": "",
            "pageIndex": 0,
            "meta": {"index": 0, "showDate": "0"},
            "cssVars": {
                "--width": "40mm",
                "--height": "40mm",
                "--translate-x": "0mm",
                "--translate-y": "20mm",
            },
        }
    )
    doc = normalize_document(raw)
    by_id = {layer["id"]: layer for layer in doc["layers"]}
    assert by_id["cb-false"]["meta"]["checked"] is False
    assert by_id["cb-true"]["meta"]["checked"] is True
    assert by_id["cb-bool"]["meta"]["checked"] is True
    assert by_id["slot"]["meta"]["showDate"] is False


def test_duplicate_document_drops_orphan_parent_id() -> None:
    raw = create_empty_document()
    raw["layers"].append(
        {
            "id": "child",
            "type": "text",
            "name": "Child",
            "value": "x",
            "parentId": "does-not-exist",
            "cssVars": {
                "--width": "40mm",
                "--height": "10mm",
                "--translate-x": "10mm",
                "--translate-y": "10mm",
            },
        }
    )
    doc = duplicate_document(raw)
    child = next(layer for layer in doc["layers"] if layer["type"] == "text" and layer["name"] == "Child")
    assert "parentId" not in child


def test_canvas_history_store_roundtrip(tmp_path: Path) -> None:
    store = CanvasStore(tmp_path)
    created = store.create(name="Doc History")
    doc_id = created["id"]

    past_doc = create_empty_document(name="Past")
    past_doc["id"] = doc_id
    future_doc = create_empty_document(name="Future")
    future_doc["id"] = doc_id

    store.save_history(doc_id, [past_doc], [future_doc])

    loaded = store.get_history(doc_id)
    assert len(loaded["past"]) == 1
    assert loaded["past"][0]["name"] == "Past"
    assert len(loaded["future"]) == 1
    assert loaded["future"][0]["name"] == "Future"


def test_canvas_history_max_history_capping(tmp_path: Path) -> None:
    store = CanvasStore(tmp_path)
    created = store.create(name="Doc Cap")
    doc_id = created["id"]

    past_stack = [create_empty_document(name=f"Past-{i}") for i in range(40)]
    store.save_history(doc_id, past_stack, [], max_history=30)

    loaded = store.get_history(doc_id)
    assert len(loaded["past"]) == 30
    assert loaded["past"][0]["name"] == "Past-10"
    assert loaded["past"][-1]["name"] == "Past-39"


def test_canvas_history_corrupt_file_returns_empty(tmp_path: Path) -> None:
    store = CanvasStore(tmp_path)
    created = store.create(name="Corrupt Hist")
    doc_id = created["id"]

    hist_file = store._history_path_for(doc_id)
    hist_file.write_text("invalid json content{{{", encoding="utf-8")

    loaded = store.get_history(doc_id)
    assert loaded == {"past": [], "future": []}


def test_canvas_history_deleted_on_doc_delete(tmp_path: Path) -> None:
    store = CanvasStore(tmp_path)
    created = store.create(name="To Delete")
    doc_id = created["id"]

    store.save_history(doc_id, [create_empty_document()], [])
    hist_file = store._history_path_for(doc_id)
    assert hist_file.exists()

    assert store.delete(doc_id) is True
    assert not hist_file.exists()


def test_canvas_history_ipc_handlers(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = CanvasStore(tmp_path)
    monkeypatch.setattr("backend.core.canvas.get_canvas_store", lambda: store)

    created = canvas_handlers.canvas_create({"name": "IPC Hist"})
    doc_id = created["document"]["id"]

    res_get = canvas_handlers.canvas_get_history({"id": doc_id})
    assert res_get == {"past": [], "future": []}

    past_doc = create_empty_document(name="Past IPC")
    canvas_handlers.canvas_save_history({"id": doc_id, "past": [past_doc], "future": []})

    res_get_updated = canvas_handlers.canvas_get_history({"id": doc_id})
    assert len(res_get_updated["past"]) == 1
    assert res_get_updated["past"][0]["name"] == "Past IPC"


def test_store_index_avoids_full_rescan_on_steady_state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = CanvasStore(tmp_path)
    for i in range(5):
        store.create(name=f"Doc {i}")

    store.list_documents()

    read_calls = 0
    original_read_text = Path.read_text

    def counting_read_text(self, *args, **kwargs):
        nonlocal read_calls
        read_calls += 1
        return original_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", counting_read_text)

    first_doc = store.list_documents()[0]
    doc = store.get(first_doc["id"])
    assert doc is not None
    store.save(doc, touch=False)
    store.list_documents()

    assert read_calls == 1, f"Expected 1 read (the get), got {read_calls}"

    read_calls = 0
    store.create(name="New Doc")
    store.list_documents()
    assert read_calls == 0, f"Expected 0 reads (incremental index update), got {read_calls}"

    read_calls = 0
    all_docs = store.list_documents()
    store.delete(all_docs[0]["id"])
    store.list_documents()
    assert read_calls == 0, f"Expected 0 reads (incremental delete), got {read_calls}"


def test_store_index_detects_external_file_changes(tmp_path: Path) -> None:
    import json

    store = CanvasStore(tmp_path)
    store.create(name="Original")
    store.list_documents()

    body = create_empty_document(name="External")
    body["id"] = "ext-id"
    (tmp_path / "ext.json").write_text(json.dumps(body), encoding="utf-8")

    listed = store.list_documents()
    names = {item["name"] for item in listed}
    assert "External" in names

    by_inner = store.get("ext-id")
    assert by_inner is not None
    assert by_inner["name"] == "External"


def test_save_history_drops_oversized_entries(tmp_path: Path) -> None:
    store = CanvasStore(tmp_path)
    created = store.create(name="Hist")
    doc_id = created["id"]
    huge = {"type": "diff", "ops": [{"v": "x" * (9 * 1024 * 1024)}]}
    small = {"type": "diff", "ops": [{"v": "ok"}]}
    assert store.save_history(doc_id, [huge, small], []) is True
    hist = store.get_history(doc_id)
    assert hist["past"] == [small]
    assert hist["future"] == []


def test_get_history_skips_oversized_entries_on_disk(tmp_path: Path) -> None:
    import json

    store = CanvasStore(tmp_path)
    created = store.create(name="Hist")
    doc_id = created["id"]
    path = store._history_path_for(doc_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "past": [
                    {"type": "diff", "ops": [{"v": "x" * (9 * 1024 * 1024)}]},
                    {"type": "diff", "ops": [{"v": "keep"}]},
                ],
                "future": [],
            }
        ),
        encoding="utf-8",
    )
    hist = store.get_history(doc_id)
    assert hist["past"] == [{"type": "diff", "ops": [{"v": "keep"}]}]


def test_normalize_allows_component_layer_type() -> None:
    raw = create_empty_document()
    raw["layers"].append(
        {
            "id": "comp-1",
            "type": "component",
            "name": "Botón",
            "value": "",
            "meta": {"componentId": "comp-1"},
            "cssVars": {
                "--width": "40mm",
                "--height": "12mm",
                "--translate-x": "10mm",
                "--translate-y": "10mm",
                "--background-color": "#3366FF",
            },
        }
    )
    doc = normalize_document(raw)
    types = [layer["type"] for layer in doc["layers"]]
    assert "component" in types
    master = next(layer for layer in doc["layers"] if layer["id"] == "comp-1")
    assert master["meta"]["componentId"] == "comp-1"


def test_normalize_preserves_instance_meta_fields() -> None:
    raw = create_empty_document()
    raw["layers"].append(
        {
            "id": "inst-1",
            "type": "component",
            "name": "Botón instancia",
            "value": "",
            "meta": {
                "instanceOf": "comp-1",
                "variant": "primary",
                "overrideVars": {
                    "--translate-x": "50mm",
                    "--background-color": "#FF0000",
                },
            },
            "cssVars": {
                "--width": "40mm",
                "--height": "12mm",
                "--translate-x": "50mm",
                "--translate-y": "10mm",
                "--background-color": "#FF0000",
            },
        }
    )
    doc = normalize_document(raw)
    inst = next(layer for layer in doc["layers"] if layer["id"] == "inst-1")
    assert inst["meta"]["instanceOf"] == "comp-1"
    assert inst["meta"]["variant"] == "primary"
    assert inst["meta"]["overrideVars"]["--translate-x"] == "50mm"
    assert inst["meta"]["overrideVars"]["--background-color"] == "#FF0000"


def test_normalize_omits_invalid_instance_meta() -> None:
    raw = create_empty_document()
    raw["layers"].append(
        {
            "id": "inst-bad",
            "type": "component",
            "name": "Bad",
            "value": "",
            "meta": {
                "instanceOf": "   ",
                "variant": "",
                "overrideVars": {
                    "--width": 40,
                    123: "nope",
                    "--bad": {"nested": True},
                },
                "componentId": "",
            },
            "cssVars": {
                "--width": "40mm",
                "--height": "12mm",
                "--translate-x": "0mm",
                "--translate-y": "0mm",
            },
        }
    )
    doc = normalize_document(raw)
    inst = next(layer for layer in doc["layers"] if layer["id"] == "inst-bad")
    meta = inst.get("meta") or {}
    assert "instanceOf" not in meta
    assert "variant" not in meta
    assert "componentId" not in meta
    assert meta.get("overrideVars") == {"--width": "40"}


def test_normalize_preserves_component_variants() -> None:
    raw = create_empty_document()
    raw["layers"].append(
        {
            "id": "comp-1",
            "type": "component",
            "name": "Botón",
            "value": "",
            "meta": {
                "componentId": "comp-1",
                "variants": {
                    "primary": {"--background-color": "#3366FF"},
                    "bad": "nope",
                    "": {"--background-color": "#000"},
                },
            },
            "cssVars": {
                "--width": "40mm",
                "--height": "12mm",
                "--translate-x": "10mm",
                "--translate-y": "10mm",
            },
        }
    )
    doc = normalize_document(raw)
    master = next(layer for layer in doc["layers"] if layer["id"] == "comp-1")
    assert master["meta"]["variants"] == {"primary": {"--background-color": "#3366FF"}}


def test_duplicate_document_remaps_instanceOf_and_componentId() -> None:
    raw = create_empty_document()
    raw["layers"].append(
        {
            "id": "comp-1",
            "type": "component",
            "name": "Master",
            "value": "",
            "meta": {"componentId": "comp-1"},
            "cssVars": {
                "--width": "40mm",
                "--height": "12mm",
                "--translate-x": "10mm",
                "--translate-y": "10mm",
            },
        }
    )
    raw["layers"].append(
        {
            "id": "inst-1",
            "type": "component",
            "name": "Inst",
            "value": "",
            "meta": {"instanceOf": "comp-1", "overrideVars": {"--translate-x": "50mm"}},
            "cssVars": {
                "--width": "40mm",
                "--height": "12mm",
                "--translate-x": "50mm",
                "--translate-y": "10mm",
            },
        }
    )
    dup = duplicate_document(raw)
    by_name = {layer["name"]: layer for layer in dup["layers"]}
    master = by_name["Master"]
    inst = by_name["Inst"]
    assert master["id"] != "comp-1"
    assert master["meta"]["componentId"] == master["id"]
    assert inst["meta"]["instanceOf"] == master["id"]
    assert inst["meta"]["overrideVars"]["--translate-x"] == "50mm"


def test_normalize_allows_boolean_layer_type() -> None:
    raw = create_empty_document()
    raw["layers"].append(
        {
            "id": "bool-1",
            "type": "boolean",
            "name": "Booleana",
            "value": "",
            "meta": {
                "ops": [
                    {"op": "union", "layerId": "a"},
                    {"op": "subtract", "layerId": "b"},
                ]
            },
            "cssVars": {
                "--width": "40mm",
                "--height": "40mm",
                "--translate-x": "10mm",
                "--translate-y": "10mm",
            },
        }
    )
    doc = normalize_document(raw)
    types = [layer["type"] for layer in doc["layers"]]
    assert "boolean" in types
    layer = next(layer for layer in doc["layers"] if layer["id"] == "bool-1")
    assert layer["meta"]["ops"] == [
        {"op": "union", "layerId": "a"},
        {"op": "subtract", "layerId": "b"},
    ]


def test_normalize_preserves_mask_and_boolean_ops() -> None:
    raw = create_empty_document()
    raw["layers"].append(
        {
            "id": "masked-1",
            "type": "image",
            "name": "Foto",
            "value": "",
            "meta": {"maskLayerId": "mask-shape"},
            "cssVars": {
                "--width": "40mm",
                "--height": "40mm",
                "--translate-x": "0mm",
                "--translate-y": "0mm",
            },
        }
    )
    doc = normalize_document(raw)
    layer = next(layer for layer in doc["layers"] if layer["id"] == "masked-1")
    assert layer["meta"]["maskLayerId"] == "mask-shape"


def test_normalize_omits_invalid_mask_and_ops() -> None:
    raw = create_empty_document()
    raw["layers"].append(
        {
            "id": "bad-bool",
            "type": "boolean",
            "name": "Bad",
            "value": "",
            "meta": {
                "maskLayerId": "   ",
                "ops": [
                    {"op": "merge", "layerId": "a"},
                    {"op": "union", "layerId": ""},
                    {"op": "intersect", "layerId": "ok"},
                    "not-a-dict",
                    {"op": "exclude"},
                ],
            },
            "cssVars": {
                "--width": "40mm",
                "--height": "40mm",
                "--translate-x": "0mm",
                "--translate-y": "0mm",
            },
        }
    )
    doc = normalize_document(raw)
    layer = next(layer for layer in doc["layers"] if layer["id"] == "bad-bool")
    meta = layer.get("meta") or {}
    assert "maskLayerId" not in meta
    assert meta.get("ops") == [{"op": "intersect", "layerId": "ok"}]


def test_normalize_prunes_dangling_and_self_referencing_parent_id() -> None:
    raw = create_empty_document()
    raw["layers"].extend(
        [
            {
                "id": "valid-child",
                "type": "text",
                "name": "Child",
                "value": "Text",
                "parentId": "non-existent-parent",
                "cssVars": {"--width": "20mm", "--height": "10mm", "--translate-x": "0mm", "--translate-y": "0mm"},
            },
            {
                "id": "self-loop",
                "type": "text",
                "name": "Loop",
                "value": "Text",
                "parentId": "self-loop",
                "cssVars": {"--width": "20mm", "--height": "10mm", "--translate-x": "0mm", "--translate-y": "0mm"},
            },
        ]
    )
    doc = normalize_document(raw)
    valid_child = next(layer for layer in doc["layers"] if layer["id"] == "valid-child")
    self_loop = next(layer for layer in doc["layers"] if layer["id"] == "self-loop")
    assert "parentId" not in valid_child
    assert "parentId" not in self_loop


