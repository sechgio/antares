"""Documentos del agente: catálogo de las tres familias, datos con procedencia y artefactos."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import fitz
import pytest

from backend.core.agent import agent, agent_tools
from backend.handlers import agent_internal


def pdf_bytes(text="Documento", pages=1):
    with fitz.open() as document:
        for _ in range(pages):
            document.new_page().insert_text((30, 30), text)
        return document.tobytes()


@pytest.fixture()
def store(tmp_path, monkeypatch):
    instance = agent.AgentStore(tmp_path / "agent")
    monkeypatch.setattr(agent, "get_agent_store", lambda: instance)
    monkeypatch.setattr(agent, "get_agent_runner", lambda: agent.AgentRunner(instance, lambda name: None))
    from backend.core.agent import path_grants

    monkeypatch.setattr(path_grants, "_key_path", lambda: tmp_path / "paths-key")
    return instance


@pytest.fixture()
def templates_dir(tmp_path, monkeypatch):
    from backend.handlers import templates

    directory = tmp_path / "plantillas"
    directory.mkdir()
    (directory / "clientes.html").write_text(
        "<html><body><h1>{{ cliente }}</h1><p>{{ TOTAL }}</p>{{ nota|default('') }}</body></html>", encoding="utf-8",
    )
    monkeypatch.setattr(templates, "_preview_template_dirs", lambda: [directory])
    rendered: list[str] = []
    from backend.utils import pdf_html

    monkeypatch.setattr(pdf_html, "write_pdf_sanitized", lambda html: rendered.append(html) or pdf_bytes(html[-60:]))
    return directory


@pytest.fixture()
def sheet(tmp_path, store):
    path = tmp_path / "datos" / "clientes.csv"
    path.parent.mkdir()
    path.write_text("Cliente;Total\nUno;10\nDos;20\n", encoding="utf-8")
    os.utime(path, (time.time() - 60, time.time() - 60))
    agent_internal.HANDLERS["agent_internal_grants_add"]({"session_id": "s1", "paths": [str(path)]})
    return path


def _tool(name, params, session_id="s1"):
    out = agent_internal.HANDLERS["agent_internal_dispatch"](
        {"session_id": session_id, "call_id": f"{name}-{time.monotonic_ns()}", "name": name, "params": params}
    )
    deadline = time.monotonic() + 10
    while out["result"] is None and time.monotonic() < deadline:
        time.sleep(0.02)
        out = agent_internal.HANDLERS["agent_internal_dispatch_result"](
            {"session_id": session_id, "call_id": out["dispatch"]["call_id"]}
        )
    return json.loads(out["result"])


def test_document_tools_are_reads_or_drafts_without_approval():
    assert {"templates_catalog", "template_describe", "document_prepare",
                                      "document_generate", "artifacts_list"} <= agent_tools.READ_TOOLS
    assert "document_generate" not in agent_tools.EFFECT_TOOLS


def test_catalog_discovers_all_families_and_new_templates(store, templates_dir, monkeypatch):
    from backend.core import formatos
    from backend.handlers import canvas

    monkeypatch.setattr(canvas, "canvas_list", lambda params: {"documents": [{"id": "doc1", "name": "Panel"}]})
    monkeypatch.setattr(formatos, "list_formats", lambda: [{"id": "maquina", "name": "Máquina"}])
    listed = _tool("templates_catalog", {})["templates"]
    assert {(t["family"], t["template_id"]) for t in listed} == {
        ("html", "clientes.html"), ("canvas", "doc1"), ("formato", "maquina"),
    }
    (templates_dir / "nueva.html").write_text("<p>{{ campo }}</p>", encoding="utf-8")
    html = _tool("templates_catalog", {"family": "html"})["templates"]
    assert [t["template_id"] for t in html] == ["clientes.html", "nueva.html"]


def test_describe_reports_fields_required_and_revision(store, templates_dir):
    described = _tool("template_describe", {"family": "html", "template_id": "clientes.html"})
    assert {"cliente", "TOTAL"} <= set(described["required_fields"])
    assert "nota" not in described["required_fields"]
    assert len(described["revision"]) == 64


def test_prepare_maps_columns_and_reports_missing_fields_without_files(store, templates_dir, sheet):
    params = {"family": "html", "template_id": "clientes.html", "spreadsheet_path": str(sheet)}
    prepared = _tool("document_prepare", params)
    assert prepared["columns"] == ["Cliente", "Total"]
    assert prepared["suggested_mappings"]["cliente"] == "Cliente"
    assert prepared["ready"] is False and any("TOTAL" in p for p in prepared["pending"])
    mapped = _tool("document_prepare", {**params, "field_mappings": {"cliente": "Cliente", "TOTAL": "Total"}})
    assert mapped["ready"] is True and mapped["records"] == 2
    assert not store.drafts_dir("s1").exists() or not list(store.drafts_dir("s1").glob("*.pdf"))


def test_ungranted_spreadsheet_is_rejected(store, templates_dir, tmp_path):
    other = tmp_path / "otra.csv"
    other.write_text("a\n1\n", encoding="utf-8")
    result = _tool("document_prepare", {"family": "html", "template_id": "clientes.html", "spreadsheet_path": str(other)})
    assert "no está autorizado" in result["error"]


def test_generate_writes_draft_and_registers_artifact_with_provenance(store, templates_dir, sheet):
    params = {"family": "html", "template_id": "clientes.html", "spreadsheet_path": str(sheet),
              "field_mappings": {"cliente": "Cliente", "TOTAL": "Total"}, "filename_pattern": "Clientes"}
    result = _tool("document_generate", params)
    assert result["generated"] is True
    artifact = result["artifact"]
    file = artifact["files"][0]
    assert Path(file["path"]).parent == store.drafts_dir("s1")
    assert file["pages"] == 2 and len(file["sha256"]) == 64 and file["mime"] == "application/pdf"
    assert artifact["records"] == 2 and len(artifact["template_revision"]) == 64
    source = artifact["sources"][0]
    assert source["kind"] == "spreadsheet" and source["path"] == os.path.realpath(sheet) and "mtime_ns" in source
    assert _tool("artifacts_list", {})["artifacts"][0]["id"] == artifact["id"]
    assert _tool("artifacts_list", {}, session_id="s2")["artifacts"] == []


def test_generate_with_missing_data_creates_nothing(store, templates_dir, sheet):
    result = _tool("document_generate", {"family": "html", "template_id": "clientes.html",
                                         "spreadsheet_path": str(sheet), "filename_pattern": "Clientes"})
    assert result["generated"] is False and result["pending"]
    assert store.artifacts_for("s1") == []


def test_numbered_formats_generate_one_pdf_per_number(store, monkeypatch):
    from backend.core import formatos

    template = pdf_bytes("plantilla")
    monkeypatch.setattr(formatos, "get_template_pdf", lambda fmt_id: (template, "Formato"))
    monkeypatch.setattr(formatos, "generate_pdf", lambda fmt_id, start, end: (pdf_bytes(str(start)), "Formato.pdf"))
    result = _tool("document_generate", {"family": "formato", "template_id": "maquina", "number_from": 8,
                                         "number_to": 10, "output_mode": "individual", "filename_pattern": "Formato_{NUMERO}"})
    assert result["generated"] is True
    assert [f["pages"] for f in result["artifact"]["files"]] == [1, 1, 1]
    assert result["artifact"]["records"] == 3


def test_file_read_returns_content_with_provenance(store, sheet, tmp_path):
    read = _tool("file_read", {"path": str(sheet)})
    assert read["kind"] == "spreadsheet" and read["columns"] == ["Cliente", "Total"] and read["total_rows"] == 2
    assert read["source"]["path"] == os.path.realpath(sheet)

    pdf = tmp_path / "datos" / "informe.pdf"
    pdf.write_bytes(pdf_bytes("Texto del informe", pages=2))
    agent_internal.HANDLERS["agent_internal_grants_add"]({"session_id": "s1", "paths": [str(pdf)]})
    read_pdf = _tool("file_read", {"path": str(pdf)})
    assert read_pdf["pages"] == 2 and "Texto del informe" in read_pdf["content"][0]["text"]

    image = tmp_path / "datos" / "foto.png"
    from PIL import Image

    Image.new("RGB", (8, 4), "red").save(image)
    agent_internal.HANDLERS["agent_internal_grants_add"]({"session_id": "s1", "paths": [str(image)]})
    read_image = _tool("file_read", {"path": str(image)})
    assert (read_image["width"], read_image["height"]) == (8, 4) and "no interpreta" in read_image["note"]

    other = tmp_path / "secreto.csv"
    other.write_text("a\n1\n", encoding="utf-8")
    assert "no está autorizado" in _tool("file_read", {"path": str(other)})["error"]


def test_folder_chosen_in_the_dialog_grants_its_files_and_feeds_photos(store, templates_dir, tmp_path):
    from PIL import Image

    photos = tmp_path / "fotos"
    (photos / "sub").mkdir(parents=True)
    for name in ("Uno.png", "sub/Dos.png"):
        Image.new("RGB", (8, 8), "blue").save(photos / name)
        os.utime(photos / name, (time.time() - 60, time.time() - 60))
    (templates_dir / "fotos.html").write_text(
        "<html><body>{% for r in reports %}<h1>{{ r.data.cliente }}</h1>"
        "{% for i in r.images[:1] %}<img src='{{ i.path }}'>{% endfor %}{% endfor %}</body></html>",
        encoding="utf-8",
    )
    as_text = agent_internal.HANDLERS["agent_internal_grants_add"]({"session_id": "s1", "paths": [str(photos)]})
    assert as_text["granted"] == [] and "carpeta" in as_text["rejected"][0]["reason"]
    chosen = agent_internal.HANDLERS["agent_internal_grants_add"](
        {"session_id": "s1", "paths": [], "folders": [str(photos)]}
    )
    assert chosen["granted"] == [os.path.realpath(photos)]
    assert _tool("file_read", {"path": str(photos / "sub" / "Dos.png")})["kind"] == "image"
    outside = tmp_path / "otra.png"
    Image.new("RGB", (2, 2)).save(outside)
    assert "no está autorizado" in _tool("file_read", {"path": str(outside)})["error"]

    result = _tool("document_generate", {
        "family": "html", "template_id": "fotos.html", "rows": [{"cliente": "Uno"}, {"cliente": "Dos"}],
        "photos_folder": str(photos), "match_key": "cliente", "images_per_panel": 1, "filename_pattern": "Fotos",
    })
    assert result["generated"] is True, result
    assert {"kind": "photos_folder", "path": os.path.realpath(photos)} in result["artifact"]["sources"]
    assert "no está autorizada" in _tool("document_prepare", {
        "family": "html", "template_id": "fotos.html", "rows": [{}], "photos_folder": str(tmp_path / "datos"),
    }, session_id="s2").get("error", "")
