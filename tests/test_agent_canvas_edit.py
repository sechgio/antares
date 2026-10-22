from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest

from backend.core import canvas as canvas_core
from backend.core.agent import agent_chat, canvas_edit
from backend.core.canvas.models import create_empty_document
from backend.core.exceptions import ResourceLockedError, ValidationError


@pytest.fixture()
def store(tmp_path, monkeypatch):
    instance = canvas_core.get_canvas_store(tmp_path / "canvas")
    monkeypatch.setattr(canvas_core, "get_canvas_store", lambda: instance)
    document = create_empty_document(name="Certificado")
    document["layers"] = [
        {"id": "nombre", "type": "field", "pageIndex": 0, "value": "", "meta": {"key": "NOMBRE"}, "cssVars": {}},
        {"id": "titulo", "type": "text", "pageIndex": 0, "value": "Certificado", "cssVars": {}},
    ]
    return instance, instance.save(document)


def test_fills_existing_fields_against_the_read_revision(store):
    instance, saved = store
    result = canvas_edit.fill_fields({"id": saved["id"], "expected_updated_at": saved["updatedAt"],
                                      "values": {"NOMBRE": "Ana"}})
    assert result["fields_changed"] == 1
    layers = {layer["id"]: layer for layer in instance.get(saved["id"])["layers"]}
    assert layers["nombre"]["value"] == "Ana" and layers["titulo"]["value"] == "Certificado"
    history = instance.get_history(saved["id"])
    assert history["past"][-1]["layers"][0]["value"] == ""
    assert history["future"] == []


def test_preserves_existing_undo_history_and_clears_redo(store):
    instance, saved = store
    instance.save_history(saved["id"], [saved], [saved])
    canvas_edit.fill_fields({"id": saved["id"], "expected_updated_at": saved["updatedAt"], "values": {"NOMBRE": "Ana"}})
    history = instance.get_history(saved["id"])
    assert len(history["past"]) == 2 and history["past"][0] == saved
    assert history["future"] == []


def test_rejects_stale_revisions_and_unknown_fields(store):
    instance, saved = store
    with pytest.raises(ValueError, match="cambió"):
        canvas_edit.fill_fields({"id": saved["id"], "expected_updated_at": "2000-01-01T00:00:00Z",
                                 "values": {"NOMBRE": "Ana"}})
    with pytest.raises(ValueError, match="no tiene estos campos"):
        canvas_edit.fill_fields({"id": saved["id"], "expected_updated_at": saved["updatedAt"],
                                 "values": {"titulo": "Otro"}})
    assert instance.get(saved["id"])["updatedAt"] == saved["updatedAt"]


def test_agent_cannot_write_whole_canvas_documents():
    names = {spec["name"]: spec for spec in agent_chat.tool_specs()}
    assert "canvas_save" not in names and "canvas_save_history" not in names
    assert names["canvas_fill_fields"]["gated"] is True and names["canvas_fill_fields"]["module"] == "canvas"
    assert names["canvas_apply_layers"]["gated"] is True and names["canvas_apply_layers"]["module"] == "canvas"


def _layer(layer_id="title", **patch):
    return {"id": layer_id, "type": "text", "name": layer_id, "value": "Título", "pageIndex": 0,
            "cssVars": {"--translate-x": "10mm", "--translate-y": "10mm", "--width": "190mm", "--height": "10mm",
                        "--font-size": "16pt", "--color": "#123456"}, **patch}


def _apply(saved, layers, **params):
    return canvas_edit.apply_layers({"id": saved["id"], "expected_updated_at": saved["updatedAt"],
                                     "layers": layers, **params})


def test_merge_operations_fields_and_replace_preserve_history(store):
    instance, _ = store
    base = instance.create(name="Plantilla nueva")
    result = _apply(base, [_layer("header", type="rect"), _layer("name", type="field", meta={"key": "NOMBRE"})],
                    fields=[{"key": "NOMBRE", "label": "Nombre completo"}], values={"NOMBRE": "Ana"})
    assert len(result["createdLayers"]) == 2
    assert result["layers"][0] == base["layers"][0]
    assert result["layers"][-1]["value"] == "Ana"
    updated = _apply(result, [{"op": "update", "id": "name", "cssVars": {"--font-size": "5mm"}},
                              {"op": "delete", "id": "header"}, {"op": "reorder", "id": "name", "index": 0}])
    assert [layer["id"] for layer in updated["layers"]] == ["name", base["layers"][0]["id"]]
    assert updated["layers"][0]["value"] == "Ana"
    assert updated["layers"][0]["cssVars"]["--color"] == "#123456"
    assert updated["layers"][0]["cssVars"]["--font-size"] == "5mm"
    filled = canvas_edit.fill_fields({"id": base["id"], "expected_updated_at": updated["updatedAt"],
                                      "values": {"NOMBRE": "Bea"}})
    replaced = _apply(filled, [_layer(value="Reemplazo")], mode="replace")
    assert [layer["id"] for layer in replaced["layers"]] == ["title"]
    assert replaced["fields"] == []
    history = instance.get_history(base["id"])
    assert history["past"][-1]["layers"][0]["value"] == "Bea" and history["future"] == []


@pytest.mark.parametrize("operation, message", [
    (_layer(cssVars={"--translate-x": "2px"}), "mm"),
    (_layer(cssVars={"--translate-x": "-1mm"}), "mm"),
    (_layer(cssVars={"--translate-x": "NaNmm"}), "mm"),
    (_layer(cssVars={"--translate-x": "205mm", "--translate-y": "0mm", "--width": "20mm", "--height": "10mm"}), "dentro"),
    (_layer(pageIndex=1), "pageIndex"),
    (_layer(pageIndex=True), "pageIndex"),
    (_layer(parentId="missing"), "parentId"),
    (_layer(parentId="title"), "ciclo"),
    ({"id": "missing", "op": "update", "value": "No"}, "no encontrada"),
    (_layer(type="unknown"), "type"),
    (_layer(type=[]), "type"),
])
def test_invalid_batch_does_not_write_document_or_history(store, operation, message):
    instance, _ = store
    base = instance.create()
    with pytest.raises(ValidationError, match=message):
        _apply(base, [_layer("valid"), operation])
    assert instance.get(base["id"]) == base
    assert instance.get_history(base["id"]) == {"past": [], "future": []}


@pytest.mark.parametrize("patch, message", [
    ({"cssVars": {"--opacity": "NaN"}}, "opacity"),
    ({"cssVars": {"--opacity": "-1"}}, "opacity"),
    ({"cssVars": {"--font-size": "16px"}}, "font-size"),
    ({"cssVars": {"--border-radius": "5%"}}, "border-radius"),
    ({"cssVars": {"--text-align": "invalid"}}, "text-align"),
    ({"cssVars": {"--width": "0mm"}}, "mayores"),
])
def test_invalid_style_update_keeps_previous_revision(store, patch, message):
    instance, _ = store
    result = _apply(instance.create(), [_layer()])
    with pytest.raises(ValidationError, match=message):
        _apply(result, [{"id": "title", "op": "update", **patch}])
    assert instance.get(result["id"])["layers"] == result["layers"]
    assert instance.get(result["id"])["updatedAt"] == result["updatedAt"]


def test_parent_validation_duplicate_ids_and_generated_ids(store):
    instance, _ = store
    base = instance.create()
    result = _apply(base, [_layer("child", parentId="group"), _layer("group", type="group")])
    with pytest.raises(ValidationError, match="parentId"):
        _apply(result, [{"id": "group", "op": "delete"}])
    with pytest.raises(ValidationError, match="duplicado"):
        _apply(result, [_layer("child", op="create")])
    with pytest.raises(ValidationError, match="index"):
        _apply(result, [{"id": "child", "op": "reorder", "index": 100}])
    no_id = _layer()
    del no_id["id"]
    generated = _apply(result, [no_id])
    assert generated["createdLayers"][0]["id"]
    assert generated["layers"][-1]["name"] == "title"


def test_stale_revision_and_missing_revision_are_rejected(store):
    instance, _ = store
    base = instance.create()
    result = _apply(base, [_layer()])
    assert result["updatedAt"] != base["updatedAt"]
    with pytest.raises(ResourceLockedError, match="expected_updated_at"):
        _apply(base, [_layer(value="Edición obsoleta")])
    with pytest.raises(ValidationError, match="expected_updated_at"):
        _apply(base, [], expected_updated_at="")
    assert instance.get(base["id"])["layers"] == result["layers"]


def test_merge_preserves_legacy_fields_without_definitions(store):
    instance, base = store
    result = _apply(base, [_layer("new")])
    assert result["layers"][:2] == base["layers"]
    assert result["fields"] == []
    assert instance.get(base["id"])["layers"] == result["layers"]


@pytest.mark.parametrize("params, message", [
    ({"fields": [{"key": "DUP"}, {"key": "DUP"}]}, "duplicada"),
    ({"fields": [{"key": "UNO", "id": "same"}, {"key": "DOS", "id": "same"}]}, "duplicado"),
    ({"values": {"INEXISTENTE": "X"}}, "sin capa"),
    ({"layers": [_layer(type="field")]}, "meta.key"),
    ({"layers": [_layer(type="field", meta={"key": "FALTA"})]}, "Define"),
    ({"layers": [_layer(type="field", meta={"key": "NOMBRE"})], "fields": [{"key": "NOMBRE"}],
      "values": {"NOMBRE": 42}}, "textos"),
])
def test_invalid_fields_leave_document_unchanged(store, params, message):
    instance, _ = store
    base = instance.create()
    with pytest.raises(ValidationError, match=message):
        canvas_edit.apply_layers({"id": base["id"], "expected_updated_at": base["updatedAt"], "layers": [], **params})
    assert instance.get(base["id"]) == base


def test_concurrent_batches_cannot_both_overwrite_the_same_revision(store):
    instance, _ = store
    base = instance.create()

    def apply(layer_id):
        try:
            return _apply(base, [_layer(layer_id)])
        except ResourceLockedError:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(apply, ["first", "second"]))
    winners = [result for result in results if result is not None]
    assert len(winners) == 1
    assert instance.get(base["id"])["layers"] == winners[0]["layers"]
