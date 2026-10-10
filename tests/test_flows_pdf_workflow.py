"""PDFs guiados: entradas autorizadas, lote completo y motores del proyecto."""

from __future__ import annotations

import base64
import os
import time
from pathlib import Path

import fitz
import pytest
from PIL import Image

from backend.core.canvas.models import create_empty_document
from backend.core.flows import pdf_workflow
from backend.core.flows.runner import FlowRunner, _CancelEvent
from backend.core.flows.store import FlowStore
from backend.handlers import flows


@pytest.fixture
def batch(tmp_path, monkeypatch):
    store = FlowStore(tmp_path / "flows.json", tmp_path / "runs.json")
    monkeypatch.setattr(flows, "_store", lambda: store)
    source, output = tmp_path / "fotos", tmp_path / "salida"
    source.mkdir()
    output.mkdir()
    params = {"guided_pdf": True, "template_kind": "html", "template_id": "report.html",
              "source_folder": str(source), "output_folder": str(output),
              "rows": [{"NIS": "20", "direccion": "Primera"}, {"NIS": "200", "direccion": "Segunda"}],
              "match_key": "NIS", "images_per_panel": 1, "field_mappings": {"DIRECCION": "direccion"},
              "field_values": {"CENTRO": "Centro común"}, "filename_pattern": "Informe_{NIS}.pdf",
              "_flow_file_grants": store.authorize_paths({"folders": [str(source)], "write": [str(output)]})}
    return store, source, output, params


def photo(path, stable=True):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (24, 24), "red").save(path)
    if stable:
        os.utime(path, (time.time() - 30, time.time() - 30))


def pdf_bytes(text="Documento"):
    with fitz.open() as document:
        document.new_page().insert_text((30, 30), text)
        return document.tobytes()


def complete(batch):
    photo(batch[1] / "visita_20" / "primera.png")
    photo(batch[1] / "200_segunda.png")
    return flows._read_images(batch[3])


def test_preparation_matches_nested_identifiers_and_manual_corrections(batch):
    result = complete(batch)
    assert result["ready"], result
    assert result["preview"][0]["images"] == ["visita_20/primera.png"]
    assert result["preview"][1]["images"] == ["200_segunda.png"]
    key = result["preview"][1]["record_key"]
    updated = flows._read_images({**batch[3], "row_values": {key: {"DIRECCION": "Corrección"}}})
    assert updated["contexts"][1]["data"]["DIRECCION"] == "Corrección"
    assert updated["contexts"][0]["data"]["CENTRO"] == "Centro común"
    assert updated["fingerprint"] != result["fingerprint"]
    assert not list(batch[2].iterdir())


def test_whole_batch_waits_and_preview_does_not_render_incomplete_inputs(batch, monkeypatch):
    photo(batch[1] / "20.png")
    render = []
    monkeypatch.setattr(pdf_workflow, "_render", lambda params: render.append(params) or pdf_bytes())
    result = flows._pdf_preview(batch[3])
    assert not result["ready"] and "Registro 2" in result["pending"][0]
    assert not render and not list(batch[2].iterdir())
    photo(batch[1] / "200.png", stable=False)
    assert "copia" in flows._read_images(batch[3])["reason"]


def test_dates_disambiguate_repeated_keys_and_overrides_preserve_photo_order(batch):
    rows = [{"NIS": "20", "Fecha": "2026-10-01"}, {"NIS": "20", "Fecha": "2026-10-02"}]
    photo(batch[1] / "20_2026-10-01_a.png")
    photo(batch[1] / "20_2026-10-01_b.png")
    photo(batch[1] / "20_2026-10-02.png")
    args = {**batch[3], "rows": rows, "match_date": "Fecha", "field_mappings": {}}
    result = flows._read_images(args)
    assert result["ready"], result
    keys = [row["record_key"] for row in result["preview"]]
    result = flows._read_images({**args, "photo_selections": {keys[0]: ["20_2026-10-01_b.png", "20_2026-10-01_a.png"]}})
    assert result["ready"]
    assert result["preview"][0]["images"][0].endswith("_b.png")
    repeated = flows._read_images({**args, "match_date": ""})
    assert not repeated["ready"] and any("se repite" in p for p in repeated["pending"])


def test_manual_document_can_assign_photos_without_an_identifier_column(batch):
    photo(batch[1] / "foto.png")
    result = flows._read_images({**batch[3], "rows": [{}], "match_key": "", "field_mappings": {},
                                "field_values": {"NIS": "20"}, "photo_selections": {"0": ["foto.png"]}})
    assert result["ready"], result


def test_preview_is_real_pdf_and_writes_no_delivery_files(batch):
    complete(batch)
    result = flows._pdf_preview(batch[3])
    assert result["ready"], result
    with fitz.open(stream=base64.b64decode(result["pdf_base64"]), filetype="pdf") as pdf:
        assert len(pdf) == result["preview_pages"] == 1
        assert "Primera" in pdf[0].get_text()
        assert pdf[0].get_images()
    assert not list(batch[2].iterdir())


@pytest.mark.parametrize("extension", ["csv", "xlsx"])
def test_reads_native_selected_spreadsheets_and_suggests_spanish_columns(batch, extension):
    store, source, _, params = batch
    sheet = source / f"datos.{extension}"
    if extension == "csv":
        sheet.write_text("NIS;Dirección\n20;Primera\n200;Segunda\n", encoding="utf-8")
    else:
        from openpyxl import Workbook

        workbook = Workbook()
        workbook.active.append(["NIS", "Dirección"])
        workbook.active.append(["20", "Primera"])
        workbook.active.append(["200", "Segunda"])
        workbook.save(sheet)
    os.utime(sheet, (time.time() - 30, time.time() - 30))
    grants = store.authorize_paths({"folders": [str(source)], "write": [params["output_folder"]], "read": [str(sheet)]})
    result = flows._read_images({**params, "rows": None, "spreadsheet_path": str(sheet), "_flow_file_grants": grants,
                                "images_per_panel": 0, "field_mappings": {"DIRECCION": "Dirección"}})
    assert result["ready"], result
    assert result["suggested_mappings"]["DIRECCION"] == "Dirección"
    assert result["contexts"][1]["data"]["DIRECCION"] == "Segunda"


def test_canvas_preview_size_failure_creates_no_spill_file(batch, monkeypatch):
    from backend.core.cmyk_pdf.renderer import CanvasCmykRenderer
    from backend.handlers import canvas

    document = create_empty_document(name="Grande")
    document["layers"] = [{"id": "texto", "type": "text", "pageIndex": 0, "value": "Texto", "cssVars": {}}]
    monkeypatch.setattr(canvas, "canvas_get", lambda params: {"document": document})
    monkeypatch.setattr(canvas, "_MAX_INLINE_PDF_BYTES", 1)
    monkeypatch.setattr(CanvasCmykRenderer, "render", lambda self, **params: pdf_bytes())
    with pytest.raises(ValueError, match="supera 40 MiB"):
        flows._pdf_preview({**batch[3], "template_kind": "canvas", "template_id": "local", "images_per_panel": 0})
    assert not list(batch[2].iterdir())


@pytest.mark.parametrize("mode,count,pages", [("consolidado", 1, 2), ("individual", 2, 1)])
def test_exports_all_rows_and_reuses_identical_outputs(batch, mode, count, pages):
    complete(batch)
    prepared = flows._read_images({**batch[3], "output_mode": mode})
    result = flows._render_pdf(prepared["pdf_args"])
    assert result["ready"] and len(result["saved_paths"]) == count
    assert result["saved_paths"] == prepared["planned_paths"]
    for path in result["saved_paths"]:
        with fitz.open(path) as pdf:
            assert len(pdf) == pages
    assert flows._render_pdf(prepared["pdf_args"])["saved_paths"] == result["saved_paths"]
    changed = flows._read_images({**batch[3], "output_mode": mode, "field_values": {"CENTRO": "Nueva versión"}})
    flows._render_pdf(changed["pdf_args"])
    assert len(list(batch[2].glob("*.pdf"))) == count * 2


def test_all_bundled_html_templates_can_be_prepared_and_rendered(batch, monkeypatch):
    from backend.handlers.templates import templates_list
    from backend.utils import pdf_html

    rendered = []
    monkeypatch.setattr(pdf_html, "write_pdf_sanitized", lambda html: rendered.append(html) or pdf_bytes())
    for template in templates_list({"recursive": True})["templates"]:
        args = {**batch[3], "template_id": template["name"], "rows": [{}], "match_key": "", "images_per_panel": 0,
                "field_mappings": {}, "field_values": {"OT": "42", "FECHA_TRABAJO": "2026-10-01", "NIS": "20",
                                                        "cuadrante": "A", "fecha_corte": "2026-10-02", "motivo": "Mantenimiento"}}
        result = flows._pdf_preview(args)
        assert result["ready"] and result.get("pdf_base64"), template["name"]
    assert len(rendered) == len(templates_list({"recursive": True})["templates"])


def test_custom_html_variables_are_editable_and_consolidation_keeps_every_record(batch, monkeypatch):
    from backend.handlers import templates

    directory = batch[1] / "plantillas"
    directory.mkdir()
    (directory / "personalizado.html").write_text("<html><body><h1>{{ cliente }}</h1><p>{{ TOTAL }}</p>{{ nota|default('Sin nota') }}</body></html>", encoding="utf-8")
    monkeypatch.setattr(templates, "_preview_template_dirs", lambda: [directory])
    params = {**batch[3], "template_id": "personalizado.html", "match_key": "", "images_per_panel": 0,
              "field_mappings": {}, "filename_pattern": "Clientes", "rows": [{"cliente": "Uno", "TOTAL": "0"}, {"cliente": "Dos", "TOTAL": "7"}]}
    prepared = flows._read_images(params)
    assert prepared["ready"], prepared
    assert "cliente" in prepared["required_fields"]
    assert "nota" not in prepared["required_fields"]
    result = flows._render_pdf(prepared["pdf_args"])
    with fitz.open(result["saved_path"]) as document:
        assert len(document) == 2
        assert "Uno" in document[0].get_text() and "0" in document[0].get_text()
        assert "Dos" in document[1].get_text()
    incomplete = flows._read_images({**params, "rows": [{"cliente": "Uno"}]})
    assert not incomplete["ready"] and any("TOTAL" in error for error in incomplete["pending"])


def test_canvas_uses_the_project_renderer_and_detects_template_changes(batch, monkeypatch):
    from backend.handlers import canvas

    document = create_empty_document(name="Plantilla")
    document["layers"] = [{"id": "dato", "type": "field", "pageIndex": 0, "meta": {"key": "NIS"},
                           "cssVars": {"--width": "50mm", "--height": "10mm", "--translate-x": "10mm", "--translate-y": "10mm"}}]
    monkeypatch.setattr(canvas, "canvas_get", lambda params: {"document": document})
    args = {**batch[3], "template_kind": "canvas", "template_id": "local", "images_per_panel": 0}
    prepared = flows._read_images(args)
    assert prepared["ready"]
    result = flows._pdf_preview(args)
    with fitz.open(stream=base64.b64decode(result["pdf_base64"]), filetype="pdf") as pdf:
        assert "20" in pdf[0].get_text()
    document["name"] = "Plantilla nueva"
    assert not flows._render_pdf(prepared["pdf_args"])["ready"]
    assert not list(batch[2].iterdir())


def test_numbered_formats_use_their_existing_generator(batch, monkeypatch):
    from backend.core import formatos

    template = pdf_bytes()
    monkeypatch.setattr(formatos, "get_template_pdf", lambda id: (template, "Formato"))
    called = []
    monkeypatch.setattr(formatos, "generate_pdf", lambda id, start, end: called.append((id, start, end)) or (pdf_bytes(str(start)), "Formato.pdf"))
    params = {**batch[3], "template_kind": "formato", "template_id": "formato", "number_from": 8, "number_to": 10,
              "images_per_panel": 0, "field_mappings": {}, "output_mode": "individual", "filename_pattern": "Formato_{NUMERO}"}
    prepared = flows._read_images(params)
    assert prepared["ready"]
    assert flows._render_pdf(prepared["pdf_args"])["count"] == 3
    assert called == [("formato", 8, 8), ("formato", 9, 9), ("formato", 10, 10)]


def test_reads_saved_records_without_creating_or_updating_them(batch, monkeypatch):
    import backend.handlers

    called = []
    monkeypatch.setattr(backend.handlers, "HANDLERS", {"technical_reports_list": lambda params: called.append(params) or {"items": [{"id": 7, "header": {"sgio": "42"}, "metadata": {"dia": 0}}]}})
    result = flows._read_images({**batch[3], "records_source": "technical_reports", "match_key": "", "rows": None,
                                "images_per_panel": 0, "field_mappings": {"OT": "header.sgio"}, "filename_pattern": "Informe_{OT}"})
    assert result["ready"], result
    assert result["contexts"][0]["data"]["OT"] == "42"
    assert result["contexts"][0]["data"]["metadata.dia"] == "0"
    assert result["match_key"] == "header.sgio"
    assert called == [{"summary": False}]


def test_rejects_unsigned_paths_traversal_and_changed_photos(batch):
    with pytest.raises(ValueError, match="seleccionar"):
        flows._read_images({**batch[3], "_flow_file_grants": {"folders": [str(batch[1])]}})
    prepared = complete(batch)
    assert not flows._read_images({**batch[3], "filename_pattern": "../salida.pdf"})["ready"]
    photo(batch[1] / "200_segunda.png")
    Image.new("RGB", (24, 24), "blue").save(batch[1] / "200_segunda.png")
    assert not flows._render_pdf(prepared["pdf_args"])["ready"]
    assert not list(batch[2].iterdir())


def test_photo_dates_are_part_of_the_output_version(batch):
    prepared = complete(batch)
    image = batch[1] / "200_segunda.png"
    os.utime(image, (time.time() - 3600, time.time() - 3600))
    assert not flows._render_pdf(prepared["pdf_args"])["ready"]
    updated = flows._read_images(batch[3])
    assert updated["ready"] and updated["fingerprint"] != prepared["fingerprint"]


def test_individual_export_renders_whole_batch_before_writing(batch, monkeypatch):
    complete(batch)
    prepared = flows._read_images({**batch[3], "output_mode": "individual"})
    def render(params):
        if params["contexts"][0]["data"]["NIS"] == "200":
            raise ValueError("Plantilla incompleta")
        return pdf_bytes()
    monkeypatch.setattr(pdf_workflow, "_render", render)
    with pytest.raises(ValueError, match="incompleta"):
        flows._render_pdf(prepared["pdf_args"])
    assert not list(batch[2].iterdir())


def test_write_failure_removes_only_new_outputs_and_preserves_existing_files(batch, monkeypatch):
    from contextlib import contextmanager

    complete(batch)
    prepared = flows._read_images({**batch[3], "output_mode": "individual"})
    previous = batch[2] / "entrega-anterior.pdf"
    previous.write_bytes(b"Anterior")
    original = pdf_workflow.atomic_output_file
    @contextmanager
    def fail_second(path, **kwargs):
        if path == prepared["planned_paths"][1]:
            raise OSError("Sin espacio")
        with original(path, **kwargs) as target:
            yield target
    monkeypatch.setattr(pdf_workflow, "atomic_output_file", fail_second)
    with pytest.raises(OSError, match="Sin espacio"):
        flows._render_pdf(prepared["pdf_args"])
    assert list(batch[2].iterdir()) == [previous]
    assert previous.read_bytes() == b"Anterior"


def test_runner_connects_guide_to_export_and_regenerates_missing_individual_outputs(batch):
    store, _, output, params = batch
    complete(batch)
    args = {key: value for key, value in params.items() if key != "_flow_file_grants"}
    args["output_mode"] = "individual"
    flow = store.create("Guiado", graph={"nodes": [
        {"id": "trigger", "kind": "trigger", "config": {"trigger_kind": "schedule", "runtime": "app_open", "interval_minutes": 1}},
        {"id": "entradas", "kind": "tool_call", "config": {"method": "flows_read_images", "args": args, "_file_grants": params["_flow_file_grants"]}},
        {"id": "generar", "kind": "tool_call", "config": {"method": "flows_render_pdf", "args": "=nodes.entradas.json.pdf_args"}},
    ], "edges": [{"from_node": "trigger", "to_node": "entradas"}, {"from_node": "entradas", "to_node": "generar"}]})
    runner = FlowRunner(store, {"flows_read_images": flows._read_images, "flows_render_pdf": flows._render_pdf}.get)
    def execute():
        run = store.create_run(flow["id"])
        runner._execute(run["id"], _CancelEvent())
        return store.get_run(run["id"])
    done = execute()
    assert done["status"] == "success", done["steps"]
    paths = done["steps"][-1]["output"]["saved_paths"]
    assert len(paths) == 2 and not runner.ready_to_start(store.get(flow["id"]))
    Path(paths[1]).unlink()
    assert runner.ready_to_start(store.get(flow["id"]))
    regenerated = execute()
    assert regenerated["status"] == "success", regenerated["steps"]
    assert len(list(output.glob("*.pdf"))) == 2
