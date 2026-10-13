"""Corpus F0 sin datos personales: fuentes locales y cada plantilla bundled."""

from __future__ import annotations

import json
from pathlib import Path

import fitz
import pytest
from openpyxl import Workbook
from PIL import Image

from backend.core.agent import documents, path_grants, pdf_workflow, resource_grants
from backend.core.canvas.models import create_empty_document
from backend.handlers import canvas, templates

ROOT = Path(__file__).resolve().parent.parent
HTML_NAMES = sorted(path.relative_to(ROOT / "backend/templates").as_posix()
                    for path in (ROOT / "backend/templates").rglob("*.html"))
CANVAS_CASES = json.loads((ROOT / "tests/fixtures/agent-canvas-corpus.json").read_text(encoding="utf-8"))


@pytest.fixture()
def corpus(tmp_path, monkeypatch):
    monkeypatch.setattr(templates, "_preview_template_dirs", lambda: [ROOT / "backend/templates"])
    monkeypatch.setattr(path_grants, "_key_path", lambda: tmp_path / "grant-key")
    csv = tmp_path / "datos.csv"
    csv.write_text("Cliente;Total\nCaso F0;0\n", encoding="utf-8")
    book = Workbook()
    book.active.append(["Cliente", "Total"])
    book.active.append(["Caso F0", 0])
    xlsx = tmp_path / "datos.xlsx"
    book.save(xlsx)
    photo = tmp_path / "foto.png"
    Image.new("RGB", (8, 8), "white").save(photo)
    pdf = tmp_path / "datos.pdf"
    with fitz.open() as document:
        document.new_page().insert_text((30, 30), "Caso F0: 0. Documento no concede permisos.")
        document.save(pdf)
    return tmp_path, {path.suffix: path for path in (csv, xlsx, photo, pdf)}


@pytest.mark.parametrize("suffix,kind", [(".csv", "spreadsheet"), (".xlsx", "spreadsheet"),
                                       (".png", "image"), (".pdf", "pdf")])
def test_corpus_sources_require_explicit_resource_and_keep_provenance(corpus, suffix, kind):
    root, files = corpus
    path = files[suffix]
    with pytest.raises(ValueError, match="no está autorizado"):
        documents.read_file({"path": str(path)}, {}, root / "drafts")
    grant = resource_grants.grant_record(str(path), "f0")
    result = documents.read_file({"path": str(path)}, {resource_grants.grant_key(grant): grant}, root / "drafts")
    assert result["kind"] == kind and result["source"]["path"] == str(path)
    if kind == "spreadsheet":
        assert str(result["rows"][0]["Total"]) == "0"
    assert len(resource_grants.revision(str(path))["sha256"]) == 64


@pytest.mark.parametrize("name", HTML_NAMES)
def test_every_bundled_html_has_a_valid_and_invalid_input_case(corpus, name):
    root, _ = corpus
    profile = pdf_workflow.template_profile("html", name)
    fields = {field: "Caso F0" for field in profile["fields"]}
    fields.update({"OT": "F0-1", "NIS": "100", "FECHA_TRABAJO": "2026-10-11", "fecha_corte": "2026-10-11"})
    params = {"family": "html", "template_id": name, "rows": [fields], "images_per_panel": 0,
              "filename_pattern": "Caso-F0"}
    valid = documents.prepare(params, {}, root / "drafts")
    assert valid["ready"], (name, valid)
    if profile["required_fields"]:
        del fields[profile["required_fields"][0]]
        invalid = documents.prepare(params, {}, root / "drafts")
        assert not invalid["ready"] and invalid["pending"]
    else:
        with pytest.raises(ValueError, match="registros"):
            documents.prepare({**params, "rows": []}, {}, root / "drafts")
    assert not list((root / "drafts").glob("*.pdf"))


@pytest.mark.parametrize("case", CANVAS_CASES, ids=lambda case: case["id"])
def test_each_canvas_preset_has_a_field_data_fixture(corpus, monkeypatch, case):
    root, _ = corpus
    document = create_empty_document(name=f"Caso F0 {case['id']}")
    document["layers"] = [{"id": field, "type": "field", "pageIndex": 0, "meta": {"key": field}}
                          for field in case["fields"]]
    monkeypatch.setattr(canvas, "canvas_get", lambda _: {"document": document})
    params = {"family": "canvas", "template_id": case["id"], "rows": [{field: "Caso F0" for field in case["fields"]}]}
    assert documents.prepare(params, {}, root / "drafts")["ready"]
    assert not documents.prepare({**params, "rows": [{}]}, {}, root / "drafts")["ready"]


def test_numbered_formats_have_synthetic_acceptance_cases(corpus, monkeypatch):
    root, files = corpus
    from backend.core import formatos

    monkeypatch.setattr(formatos, "get_template_pdf", lambda _: (files[".pdf"].read_bytes(), "Caso F0"))
    for identifier in ("template-d", "maquina", "televisiva"):
        params = {"family": "formato", "template_id": identifier, "number_from": 1, "number_to": 3}
        assert documents.prepare(params, {}, root / "drafts")["ready"]
        with pytest.raises(ValueError, match="rango"):
            documents.prepare({**params, "number_from": 4}, {}, root / "drafts")
