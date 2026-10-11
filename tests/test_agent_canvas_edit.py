"""Canvas desde el agente: solo campos existentes y contra la revisión leída."""

from __future__ import annotations

import pytest

from backend.core import canvas as canvas_core
from backend.core.agent import agent_chat, canvas_edit
from backend.core.canvas.models import create_empty_document


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
