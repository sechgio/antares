from __future__ import annotations

import os
import time
import urllib.request
from pathlib import Path

import fitz
import pytest
from PIL import Image

from backend.core.canvas.models import create_empty_document
from backend.core.flows import agent_chat
from backend.core.flows.runner import FlowRunner, _CancelEvent, _retry_config
from backend.core.flows.scheduler import FlowScheduler
from backend.core.flows.store import FlowStore
from backend.core.ipc_catalog import FLOW_ACTION_METHODS, ORCHESTRATABLE_METHODS
from backend.handlers import flows
from backend.handlers.canvas import canvas_export_cmyk_pdf
from backend.handlers.sellador import sellador_apply


@pytest.fixture
def setup(tmp_path, monkeypatch):
    store = FlowStore(tmp_path / "flows.json", tmp_path / "runs.json")
    monkeypatch.setattr(flows, "_store", lambda: store)
    source = tmp_path / "imagenes"
    output = tmp_path / "paneles"
    source.mkdir()
    output.mkdir()
    grants = store.authorize_paths({"folders": [str(source)], "write": [str(output)]})
    return store, source, output, grants


def _image(path, *, stable=True):
    Image.new("RGB", (24, 24), "red").save(path)
    if stable:
        os.utime(path, (time.time() - 30, time.time() - 30))


def _args(setup, **extra):
    _, source, output, grants = setup
    return {"source_folder": str(source), "output_folder": str(output), "_flow_file_grants": grants, **extra}


def _graph(setup):
    _, source, output, grants = setup
    return {
        "nodes": [
            {"id": "trigger", "kind": "trigger", "config": {"trigger_kind": "schedule", "interval_minutes": 1}},
            {"id": "template", "kind": "tool_call", "config": {"method": "canvas_get", "args": {"id": "demo"}}},
            {"id": "images", "kind": "tool_call", "config": {"method": "flows_read_images", "_file_grants": grants,
             "args": {"source_folder": str(source), "output_folder": str(output)}}},
            {"id": "pdf", "kind": "tool_call", "config": {"method": "canvas_export_cmyk_pdf", "args": {
                "document": "=nodes.template.json.document", "contexts": "=nodes.images.json.contexts",
                "localImagePaths": "=nodes.images.json.localImagePaths", "outputPath": "=nodes.images.json.output_path",
            }}},
        ],
        "edges": [{"from_node": a, "to_node": b} for a, b in [("trigger", "template"), ("template", "images"), ("images", "pdf")]],
    }


def _runner(setup, *, export=canvas_export_cmyk_pdf):
    document = create_empty_document(name="Panel")
    document["layers"] = [{
        "id": "photo", "type": "imageSlot", "pageIndex": 0, "meta": {"index": 0},
        "cssVars": {"--width": "50mm", "--height": "40mm", "--translate-x": "10mm", "--translate-y": "10mm"},
    }]
    handlers = {"canvas_get": lambda p: {"document": document}, "flows_read_images": flows._read_images,
                "canvas_export_cmyk_pdf": export}
    return FlowRunner(setup[0], handlers.get)


def _execute(store, runner, flow):
    run = store.create_run(flow["id"])
    runner._execute(run["id"], _CancelEvent())
    return store.get_run(run["id"])


def test_actions_are_callable_but_keep_agent_approval():
    for method in ("formatos_generate", "canvas_export_cmyk_pdf", "panel_aviso_corte_render_pdf",
                   "technical_reports_render_html", "process_start", "flows_render_pdf", "flows_print_pdf"):
        assert method in FLOW_ACTION_METHODS
        assert method not in ORCHESTRATABLE_METHODS
        assert next(s for s in agent_chat.tool_specs() if s["name"] == method)["gated"]
    assert "db_clear" not in FLOW_ACTION_METHODS
    assert "flows_path_authorize" not in {s["name"] for s in agent_chat.tool_specs()}


@pytest.mark.parametrize("input_mode,expected", [(None, "skipped"), ("any", "success")])
def test_action_can_reconverge_exclusive_condition_branches(setup, input_mode, expected):
    called = []
    config = {"method": "canvas_create", "args": {"name": "=item.json.name"}}
    if input_mode is not None:
        config["input_mode"] = input_mode
    flow = setup[0].create("Ramas", graph={
        "nodes": [{"id": "trigger", "kind": "trigger", "config": {}},
                  {"id": "condition", "kind": "condition", "config": {"field": "=run.trigger.yes", "value": True}},
                  {"id": "yes", "kind": "transform", "config": {"output": {"name": "Sí"}}},
                  {"id": "no", "kind": "transform", "config": {"output": {"name": "No"}}},
                  {"id": "action", "kind": "tool_call", "config": config}],
        "edges": [{"from_node": "trigger", "to_node": "condition"},
                  {"from_node": "condition", "from_port": "true", "to_node": "yes"},
                  {"from_node": "condition", "from_port": "false", "to_node": "no"},
                  {"from_node": "yes", "to_node": "action"}, {"from_node": "no", "to_node": "action"}],
    })
    runner = FlowRunner(setup[0], lambda method: lambda args: called.append(args) or {"created": True})
    for value, name in [(True, "Sí"), (False, "No")]:
        run = setup[0].create_run(flow["id"], {"yes": value})
        runner._execute(run["id"], _CancelEvent())
        assert setup[0].get_run(run["id"])["steps"][-1]["status"] == expected
        if input_mode == "any":
            assert called[-1] == {"name": name}
    assert len(called) == (2 if input_mode == "any" else 0)


def test_running_step_and_completed_steps_survive_restart(setup):
    import threading

    entered, release = threading.Event(), threading.Event()
    flow = setup[0].create("Inspección", graph={
        "nodes": [{"id": "trigger", "kind": "trigger", "config": {}},
                  {"id": "slow", "kind": "tool_call", "config": {"method": "formats"}}],
        "edges": [{"from_node": "trigger", "to_node": "slow"}],
    })

    def slow(args):
        entered.set()
        assert release.wait(5)
        return {"formats": []}

    runner = FlowRunner(setup[0], lambda method: slow)
    run = setup[0].create_run(flow["id"])
    worker = threading.Thread(target=runner._execute, args=(run["id"], _CancelEvent()))
    worker.start()
    try:
        assert entered.wait(3)
        saved = setup[0].get_run(run["id"])
        assert [step["status"] for step in saved["steps"]] == ["success", "running"]
        restarted = FlowStore(setup[0]._flows_path, setup[0]._runs_path).get_run(run["id"])
        assert restarted["status"] == "error"
        assert restarted["steps"] == saved["steps"]
    finally:
        release.set()
        worker.join(timeout=3)
    assert not worker.is_alive()


def test_report_batch_dedup_includes_destination_and_topology(setup):
    import copy

    _image(setup[1] / "100_a.png")
    args = _report_args(setup, [("100", "2026-10-04", "A")])
    graph = _report_graph(setup, args)
    calls = []
    handlers = {"flows_read_images": flows._read_images,
                "flows_render_pdf": lambda params: calls.append(params) or {"ready": True}}
    flow = setup[0].create("Lote", graph=graph)
    runner = FlowRunner(setup[0], handlers.get)
    assert _execute(setup[0], runner, flow)["status"] == "success"
    assert not runner.ready_to_start(setup[0].get(flow["id"]))
    changed = copy.deepcopy(graph)
    changed["nodes"][1]["config"]["args"]["output_folder"] = str(setup[2] / "otro")
    (setup[2] / "otro").mkdir()
    changed["nodes"][1]["config"]["_file_grants"] = setup[0].authorize_paths({
        "folders": [str(setup[1])], "write": [str(setup[2] / "otro")],
    })
    updated = setup[0].update(flow["id"], graph=changed)
    assert runner.ready_to_start(updated)
    assert _execute(setup[0], runner, updated)["status"] == "success"
    assert len(calls) == 2
    changed["edges"].append({"from_node": "trigger", "to_node": "pdf"})
    assert runner.ready_to_start(setup[0].update(flow["id"], graph=changed))


def test_source_waits_for_all_images_and_completed_copy(setup):
    _image(setup[1] / "uno.png", stable=False)
    assert flows._read_images(_args(setup, expected_images=2))["ready"] is False
    _image(setup[1] / "dos.png")
    assert flows._read_images(_args(setup, expected_images=2))["ready"] is False
    _image(setup[1] / "uno.png")
    result = flows._read_images(_args(setup, expected_images=2, images_per_panel=2))
    assert result["ready"] is True
    assert len(result["contexts"]) == 1
    assert len(result["contexts"][0]["images"]) == 2


def test_source_rejects_forged_grants(setup):
    with pytest.raises(ValueError, match="diálogos"):
        flows._read_images({**_args(setup), "_flow_file_grants": {"folders": [str(setup[1])], "write": [str(setup[2])]}})


def test_source_matches_excel_ids_without_relying_on_order(setup):
    from openpyxl import Workbook

    _image(setup[1] / "1001_a.png")
    _image(setup[1] / "1002_a.png")
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["ID", "DIRECCION"])
    sheet.append(["1002", "Segunda"])
    sheet.append(["1001", "Primera"])
    path = setup[1] / "datos.xlsx"
    workbook.save(path)
    os.utime(path, (time.time() - 30, time.time() - 30))
    result = flows._read_images(_args(setup, spreadsheet_path=str(path), key_column="ID"))
    assert result["contexts"][0]["images"] == ["flow-image:1002_a.png"]
    assert result["contexts"][0]["data"]["DIRECCION"] == "Segunda"


def test_canvas_flow_generates_real_pdf_and_deduplicates_after_restart(setup):
    store, source, output, _ = setup
    _image(source / "uno.png")
    flow = store.create("Paneles automáticos", graph=_graph(setup))
    runner = _runner(setup)
    assert runner.ready_to_start(flow)
    done = _execute(store, runner, flow)
    assert done["status"] == "success", done["steps"]
    saved = Path(done["steps"][-1]["output"]["saved_path"])
    assert saved.parent == output
    with fitz.open(saved) as pdf:
        assert len(pdf) == 1
        assert pdf[0].get_images()
    restarted = FlowStore(store._flows_path, store._runs_path)
    assert not FlowRunner(restarted, runner._handler_getter).ready_to_start(restarted.get(flow["id"]))
    done = _execute(store, runner, store.get(flow["id"]))
    assert done["steps"][-1]["status"] == "skipped"
    assert len(list(output.glob("*.pdf"))) == 1
    _image(source / "dos.png")
    assert runner.ready_to_start(store.get(flow["id"]))
    assert _execute(store, runner, store.get(flow["id"]))["status"] == "success"
    assert len(list(output.glob("*.pdf"))) == 2


def test_failure_does_not_acknowledge_source_or_retry_writes(setup):
    calls = []

    def fail(params):
        calls.append(params)
        raise ValueError("No se pudo generar")

    _image(setup[1] / "uno.png")
    graph = _graph(setup)
    graph["nodes"][-1]["config"]["retry"] = {"attempts": 5}
    flow = setup[0].create("Paneles", graph=graph)
    runner = _runner(setup, export=fail)
    assert _execute(setup[0], runner, flow)["status"] == "error"
    assert len(calls) == 1
    assert runner.ready_to_start(setup[0].get(flow["id"]))


def test_canvas_template_changes_generate_a_new_output(setup):
    _image(setup[1] / "uno.png")
    flow = setup[0].create("Paneles", graph=_graph(setup))
    runner = _runner(setup)
    assert _execute(setup[0], runner, flow)["status"] == "success"
    assert not runner.ready_to_start(setup[0].get(flow["id"]))
    document = runner._handler_getter("canvas_get")({"id": "demo"})["document"]
    document["layers"][0]["cssVars"]["--width"] = "60mm"
    assert runner.ready_to_start(setup[0].get(flow["id"]))
    assert _execute(setup[0], runner, setup[0].get(flow["id"]))["status"] == "success"
    assert len(list(setup[2].glob("*.pdf"))) == 2


def test_scheduler_does_not_create_runs_for_incomplete_source(setup):
    flow = setup[0].create("Paneles", graph=_graph(setup))
    scheduler = FlowScheduler(setup[0], _runner(setup))
    assert scheduler.tick() == 0
    assert setup[0].list_runs(flow["id"]) == []


def test_action_waits_for_every_connected_input(setup):
    graph = _graph(setup)
    graph["edges"].append({"from_node": "template", "to_node": "pdf"})
    flow = setup[0].create("Paneles", graph=graph)
    calls = []
    done = _execute(setup[0], _runner(setup, export=lambda p: calls.append(p)), flow)
    assert done["steps"][-1]["status"] == "skipped"
    assert calls == []


def test_action_rejects_hidden_output_path_outside_grant(setup):
    _image(setup[1] / "uno.png")
    graph = _graph(setup)
    graph["nodes"][-1]["config"]["args"]["_resolved_output_path"] = str(setup[1].parent / "secret.pdf")
    flow = setup[0].create("Paneles", graph=graph)
    done = _execute(setup[0], _runner(setup), flow)
    assert done["status"] == "error"
    assert "no está autorizado" in done["steps"][-1]["error"]


def test_dynamic_output_cannot_escape_granted_folder_with_parent_segments(setup):
    _image(setup[1] / "uno.png")
    graph = _graph(setup)
    graph["nodes"][-1]["config"] = {"method": "flows_render_pdf", "args": {
        "html": "<h1>Prueba</h1>", "output_path": "=run.trigger.output_path",
    }}
    flow = setup[0].create("Salida dinámica", graph=graph)
    outside = setup[2] / ".." / "fuera.pdf"
    calls = []
    handlers = {"flows_render_pdf": lambda params: calls.append(params) or {"saved_path": params["output_path"]}}
    original = _runner(setup)
    runner = FlowRunner(setup[0], lambda method: handlers.get(method) or original._handler_getter(method))
    run = setup[0].create_run(flow["id"], {"output_path": str(outside)})
    runner._execute(run["id"], _CancelEvent())
    done = setup[0].get_run(run["id"])
    assert done["status"] == "error"
    assert "no está autorizado" in done["steps"][-1]["error"]
    assert calls == []
    assert not outside.resolve().exists()


def _partial_action_flow(setup, action):
    _image(setup[1] / "uno.png")
    graph = _graph(setup)
    graph["nodes"][-1]["config"] = {"method": "flows_print_pdf", "args": {
        "pdf_path": "=nodes.images.json.files[0]", "printer_name": "Prueba",
    }}
    graph["nodes"].append({"id": "failure", "kind": "tool_call", "config": {"method": "formats"}})
    graph["edges"].append({"from_node": "trigger", "to_node": "failure"})
    original = _runner(setup)

    def fail(params):
        raise ValueError("Fallo de otra rama")

    handlers = {"flows_print_pdf": action, "formats": fail}
    runner = FlowRunner(setup[0], lambda method: handlers.get(method) or original._handler_getter(method))
    return setup[0].create("Impresión con fallo parcial", graph=graph), runner


def test_completed_action_is_not_repeated_after_other_branch_fails_and_restart(setup):
    calls = []
    flow, runner = _partial_action_flow(setup, lambda params: calls.append(params) or {"queued": True, "job_id": 7})
    first = _execute(setup[0], runner, flow)
    assert first["status"] == "error"
    assert next(s for s in first["steps"] if s["node_id"] == "pdf")["output"]["job_id"] == 7
    restarted = FlowStore(setup[0]._flows_path, setup[0]._runs_path)
    second = _execute(restarted, FlowRunner(restarted, runner._handler_getter), restarted.get(flow["id"]))
    assert second["status"] == "error"
    assert next(s for s in second["steps"] if s["node_id"] == "pdf")["output"]["job_id"] == 7
    assert len(calls) == 1
    _image(setup[1] / "dos.png")
    _execute(restarted, FlowRunner(restarted, runner._handler_getter), restarted.get(flow["id"]))
    assert len(calls) == 2


def test_uncertain_action_is_not_repeated_after_restart(setup, monkeypatch):
    calls = []
    flow, runner = _partial_action_flow(setup, lambda params: calls.append(params) or {"queued": True})

    def crash_before_receipt(*args):
        raise OSError("Simula cierre después del efecto")

    monkeypatch.setattr(setup[0], "complete_action", crash_before_receipt)
    assert _execute(setup[0], runner, flow)["status"] == "error"
    restarted = FlowStore(setup[0]._flows_path, setup[0]._runs_path)
    second = _execute(restarted, FlowRunner(restarted, runner._handler_getter), restarted.get(flow["id"]))
    assert "resultado incierto" in next(s for s in second["steps"] if s["node_id"] == "pdf")["error"]
    assert len(calls) == 1


def test_corrupt_receipt_store_does_not_reexecute_action(setup):
    calls = []
    flow, runner = _partial_action_flow(setup, lambda params: calls.append(params) or {"queued": True})
    setup[0]._effects_path.write_text("{invalid", encoding="utf-8")
    assert _execute(setup[0], runner, flow)["status"] == "error"
    assert calls == []


def test_null_action_receipt_is_uncertain_instead_of_new(setup):
    setup[0]._effects_path.write_text('{"flow:batch": null}', encoding="utf-8")
    with pytest.raises(ValueError, match="resultado incierto"):
        setup[0].begin_action("flow", "batch")


def test_pdf_from_html_is_saved(setup):
    output = setup[2] / "reporte.pdf"
    try:
        result = flows._render_pdf({"html": "<h1>Informe generado</h1>", "output_path": str(output)})
    except OSError as exc:
        if "libgobject" in str(exc):
            pytest.skip(f"Runtime WeasyPrint no disponible: {exc}")
        raise
    assert Path(result["saved_path"]).read_bytes().startswith(b"%PDF")
    with fitz.open(result["saved_path"]) as pdf:
        assert "Informe generado" in pdf[0].get_text()


def test_html_template_waits_for_missing_context(setup):
    assert flows._render_pdf({"template_name": "panel-reservorios.html", "context": {},
                              "output_path": str(setup[2] / "reporte.pdf")})["ready"] is False


def test_conversion_step_waits_until_job_finishes(setup):
    states = iter([{"running": True, "id": "flow-job"}, {"running": False, "id": "flow-job", "ok_count": 2, "err_count": 0}])
    handlers = {"process_start": lambda p: {"started": True, "job_id": "flow-job"}, "process_status": lambda p: next(states)}
    flow = setup[0].create("Convertir", graph={"nodes": [
        {"id": "trigger", "kind": "trigger", "config": {}},
        {"id": "convert", "kind": "tool_call", "config": {"method": "process_start"}},
    ], "edges": [{"from_node": "trigger", "to_node": "convert"}]})
    done = _execute(setup[0], FlowRunner(setup[0], handlers.get), flow)
    assert done["status"] == "success"
    assert done["steps"][-1]["output"]["ok_count"] == 2
    assert _retry_config(flow["graph"]["nodes"][-1]) == (1, 0.0)


def test_legacy_scalar_arguments_keep_empty_object_behavior(setup):
    calls = []
    runner = FlowRunner(setup[0], lambda method: lambda params: calls.append(params) or {"formats": []})
    assert runner._run_tool_call({"config": {"method": "formats", "args": "legacy"}}, {}) == {"json": {"formats": []}}
    assert calls == [{}]


def test_generated_pdf_can_feed_another_action(setup):
    _image(setup[1] / "uno.png")
    graph = _graph(setup)
    graph["nodes"].append({"id": "stamp", "kind": "tool_call", "config": {"method": "sellador_apply", "args": {
        "pdf_path": "=nodes.pdf.json.saved_path", "stamp_path": "=nodes.images.json.files[0]",
        "stamp_count": 1, "output_path": str(setup[2] / "sellado.pdf"),
    }}})
    graph["edges"].append({"from_node": "pdf", "to_node": "stamp"})
    runner = _runner(setup)
    handlers = {"canvas_get": runner._handler_getter("canvas_get"), "canvas_export_cmyk_pdf": canvas_export_cmyk_pdf,
                "flows_read_images": flows._read_images, "sellador_apply": sellador_apply}
    flow = setup[0].create("Generar y sellar", graph=graph)
    done = _execute(setup[0], FlowRunner(setup[0], handlers.get), flow)
    assert done["status"] == "success", done["steps"]
    with fitz.open(done["steps"][-1]["output"]["saved_path"]) as pdf:
        assert pdf[0].get_images()


@pytest.mark.parametrize("template", sorted(p.relative_to(Path("backend/templates")).as_posix()
                                          for p in Path("backend/templates").rglob("*.html")))
@pytest.mark.parametrize("image_count", [1, 7])
def test_every_bundled_template_renders_in_a_flow(setup, monkeypatch, template, image_count):
    from backend.utils import pdf_html

    for index in range(image_count):
        _image(setup[1] / f"imagen-{index}.png")
    source = flows._read_images(_args(setup, images_per_panel=image_count))
    source["contexts"][0]["data"].update({"cuadrante": "A", "fecha_corte": "2026-10-04", "motivo": "Mantenimiento"})
    captured = []
    monkeypatch.setattr(pdf_html, "write_pdf_sanitized", lambda html: captured.append(html) or b"%PDF-prueba")
    result = flows._render_pdf({"template_name": template, "contexts": source["contexts"],
                               "localImagePaths": source["localImagePaths"], "output_path": str(setup[2] / "reporte.pdf")})
    assert result.get("saved_path"), result
    assert captured and "<html" in captured[0].lower()
    if template not in {"technical_reports/informe_tecnico.html", "fichas_tecnicas/ficha_tecnica.html",
                        "Certificado-sanidad-lugo.html", "certificados-sjl-blanco.html",
                        "certificados-sjl-guardamino.html", "format_etapas.html"}:
        assert "data:image/" in captured[0], template
    assert "flow-image:" not in captured[0]


def test_template_catalog_includes_subfolders_only_when_requested(tmp_path, monkeypatch):
    from backend.handlers import templates
    from backend.handlers.templates import templates_list

    assert all("/" not in t["name"] for t in templates_list({})["templates"])
    assert "informes_v2/reservorios_2.html" in {t["name"] for t in templates_list({"recursive": True})["templates"]}
    (tmp_path / "carpeta.html").mkdir()
    (tmp_path / "plantilla.html").write_text("<html></html>")
    monkeypatch.setattr(templates, "_preview_template_dirs", lambda: [tmp_path])
    assert [t["name"] for t in templates_list({})["templates"]] == ["plantilla.html"]


@pytest.mark.parametrize("name", ["../templates/report.html", "technical_reports/../../main.py", "C:/secret.html"])
def test_flow_rejects_template_traversal(setup, name):
    with pytest.raises(ValueError, match="Selecciona una plantilla"):
        flows._render_pdf({"template_name": name, "output_path": str(setup[2] / "reporte.pdf")})


def test_pdf_stamp_print_chain_uses_stamped_file_and_deduplicates(setup, monkeypatch):
    from backend.core import printing

    _image(setup[1] / "uno.png")
    graph = _graph(setup)
    graph["nodes"].extend([
        {"id": "stamp", "kind": "tool_call", "config": {"method": "sellador_apply", "args": {
            "pdf_path": "=nodes.pdf.json.saved_path", "stamp_path": "=nodes.images.json.files[0]",
            "stamp_count": 1, "output_path": "=nodes.images.json.stamped_output_path",
        }}},
        {"id": "print", "kind": "tool_call", "config": {"method": "flows_print_pdf", "args": {
            "pdf_path": "=nodes.stamp.json.saved_path", "printer_name": "Prueba", "copies": 2,
        }}},
    ])
    graph["edges"].extend([{"from_node": "pdf", "to_node": "stamp"}, {"from_node": "stamp", "to_node": "print"}])
    queued = []
    monkeypatch.setattr(printing, "print_pdf", lambda path, printer, copies, cancelled: queued.append((path, copies)) or {"queued": True, "job_id": 1})
    runner = _runner(setup)
    handlers = {"canvas_get": runner._handler_getter("canvas_get"), "canvas_export_cmyk_pdf": canvas_export_cmyk_pdf,
                "flows_read_images": flows._read_images, "sellador_apply": sellador_apply, "flows_print_pdf": flows._print_pdf}
    runner = FlowRunner(setup[0], handlers.get)
    flow = setup[0].create("Generar, sellar e imprimir", graph=graph)
    done = _execute(setup[0], runner, flow)
    assert done["status"] == "success", done["steps"]
    assert queued == [(done["steps"][-2]["output"]["saved_path"], 2)]
    assert queued[0][0] != done["steps"][-3]["output"]["saved_path"]
    with fitz.open(queued[0][0]) as pdf:
        assert pdf[0].get_images()
    restarted = FlowStore(setup[0]._flows_path, setup[0]._runs_path)
    assert not FlowRunner(restarted, handlers.get).ready_to_start(restarted.get(flow["id"]))
    _execute(setup[0], runner, setup[0].get(flow["id"]))
    assert len(queued) == 1
    handlers["sellador_apply"] = lambda params: (_ for _ in ()).throw(ValueError("Fallo al sellar"))
    _image(setup[1] / "dos.png")
    done = _execute(setup[0], runner, setup[0].get(flow["id"]))
    assert done["status"] == "error"
    assert done["steps"][-1]["status"] == "skipped"
    assert len(queued) == 1


def test_print_rejects_pdf_without_file_grant(setup):
    node = {"config": {"method": "flows_print_pdf", "args": {"pdf_path": str(setup[1].parent / "secret.pdf"), "printer_name": "Prueba"}}}
    runner = FlowRunner(setup[0], lambda method: flows._print_pdf)
    with pytest.raises(ValueError, match="no está autorizado"):
        runner._run_tool_call(node, {"graph": {"nodes": []}})


def test_html_template_changes_invalidate_completed_batch(setup, monkeypatch):
    from backend.handlers import templates
    from backend.utils import pdf_html

    _image(setup[1] / "uno.png")
    graph = _graph(setup)
    graph["nodes"] = [n for n in graph["nodes"] if n["id"] != "template"]
    graph["edges"] = [{"from_node": "trigger", "to_node": "images"}, {"from_node": "images", "to_node": "pdf"}]
    graph["nodes"][-1]["config"] = {"method": "flows_render_pdf", "args": {
        "template_name": "report.html", "contexts": "=nodes.images.json.contexts",
        "localImagePaths": "=nodes.images.json.localImagePaths", "output_path": "=nodes.images.json.output_path",
    }}
    content = [templates.template_get({"name": "report.html"})["content"]]
    monkeypatch.setattr(templates, "template_get", lambda params: {"content": content[0]})
    monkeypatch.setattr(pdf_html, "write_pdf_sanitized", lambda html: b"%PDF-prueba")
    handlers = {"flows_read_images": flows._read_images, "flows_render_pdf": flows._render_pdf,
                "template_get": templates.template_get, "templates_list": templates.templates_list}
    runner = FlowRunner(setup[0], handlers.get)
    flow = setup[0].create("Plantilla HTML", graph=graph)
    assert _execute(setup[0], runner, flow)["status"] == "success"
    assert not runner.ready_to_start(setup[0].get(flow["id"]))
    content[0] += "<!-- plantilla actualizada -->"
    assert runner.ready_to_start(setup[0].get(flow["id"]))
    assert _execute(setup[0], runner, setup[0].get(flow["id"]))["status"] == "success"
    assert len(list(setup[2].glob("*.pdf"))) == 2
    graph["nodes"][-1]["config"]["args"]["template_name"] = "../secret.html"
    with pytest.raises(ValueError, match="Selecciona una plantilla"):
        runner._template_fingerprints(graph)


def test_print_step_requires_printer_before_scheduled_flow_starts(setup):
    _image(setup[1] / "uno.png")
    graph = _graph(setup)
    graph["nodes"].append({"id": "print", "kind": "tool_call", "config": {
        "method": "flows_print_pdf", "required_args": ["printer_name"],
        "args": {"pdf_path": "=nodes.pdf.json.saved_path", "printer_name": "", "copies": 1},
    }})
    graph["edges"].append({"from_node": "pdf", "to_node": "print"})
    flow = setup[0].create("Paneles con impresión", graph=graph)
    assert not _runner(setup).ready_to_start(flow)


def _report_args(setup, rows, *, headers=("OT", "Fecha", "Dirección"), **extra):
    from openpyxl import Workbook

    workbook = Workbook()
    workbook.active.append(headers)
    for row in rows:
        workbook.active.append(row)
    path = setup[1] / "lote.xlsx"
    workbook.save(path)
    os.utime(path, (time.time() - 30, time.time() - 30))
    return _args(setup, spreadsheet_path=str(path), report_template="report.html", images_per_panel=1,
                 field_mappings={"OT": headers[0], "FECHA_TRABAJO": headers[1], "DIRECCION": headers[2]}, **extra)


def _report_graph(setup, args):
    graph = _graph(setup)
    graph["nodes"] = [n for n in graph["nodes"] if n["id"] != "template"]
    graph["nodes"][1]["config"]["args"] = {k: v for k, v in args.items() if k != "_flow_file_grants"}
    graph["nodes"][-1]["config"] = {"method": "flows_render_pdf", "args": {
        "template_name": "report.html", "contexts": "=nodes.images.json.contexts",
        "localImagePaths": "=nodes.images.json.localImagePaths", "output_path": "=nodes.images.json.output_path",
        "photo_digests": "=nodes.images.json.photo_digests", "expected_pages": "=nodes.images.json.expected_pages",
    }}
    graph["edges"] = [{"from_node": "trigger", "to_node": "images"}, {"from_node": "images", "to_node": "pdf"}]
    return graph


def test_report_batch_recurses_maps_fields_and_limits_six_photos(setup):
    folder = setup[1] / "día"
    folder.mkdir()
    for i in range(8):
        _image(folder / f"200_{i}.png")
    _image(setup[1] / "20_a.png")
    args = _report_args(setup, [("200", "04/10/2026", "Segunda"), ("20", "2026-10-04", "Primera")])
    args["images_per_panel"] = 6
    result = flows._read_images(args)
    assert not result["ready"]
    assert result["expected_pages"] == 2
    assert result["preview"][0]["images"] == [f"día/200_{i}.png" for i in range(6)]
    assert result["contexts"][0]["data"]["DIRECCION"] == "Segunda"
    assert result["preview"][1]["images"] == ["20_a.png"]
    assert result["suggested_mappings"]["DIRECCION"] == "Dirección"
    args["images_per_panel"] = 1
    assert flows._read_images(args)["ready"]


def test_report_batch_ambiguous_dates_require_explicit_assignment(setup):
    _image(setup[1] / "100_a.png")
    _image(setup[1] / "100_b.png")
    args = _report_args(setup, [("100", "2026-10-04", "A"), ("100", "2026-10-05", "B")])
    result = flows._read_images(args)
    assert not result["ready"]
    assert "Asigna" in result["reason"]
    args["photo_selections"] = {"0": ["100_a.png"], "1": ["100_b.png"]}
    assert flows._read_images(args)["ready"]
    args["photo_selections"]["1"] = ["100_a.png"]
    assert not flows._read_images(args)["ready"]
    assert "más de una fila" in flows._read_images(args)["pending"][-1]


def test_report_batch_uses_filename_date_and_blocks_missing_mapping_or_required_data(setup):
    _image(setup[1] / "100_2026-10-04_a.png")
    _image(setup[1] / "100_05-10-2026_b.png")
    args = _report_args(setup, [("100", "2026-10-04", "A"), ("100", "2026-10-05", "B")])
    result = flows._read_images(args)
    assert result["ready"]
    assert result["preview"][0]["images"] == ["100_2026-10-04_a.png"]
    assert result["preview"][1]["images"] == ["100_05-10-2026_b.png"]
    args["field_mappings"]["DIRECCION"] = "Columna antigua"
    assert flows._read_images(args)["missing_mappings"] == ["DIRECCION"]
    assert not flows._read_images(args)["ready"]
    args = _report_args(setup, [("100", "fecha inválida", "A"), ("", "2026-10-05", "B")])
    assert not flows._read_images(args)["ready"]
    assert any("Falta la OT" in pending for pending in flows._read_images(args)["pending"])


def test_report_batch_content_identity_ignores_timestamp_unused_photos_and_excel_repacking(setup):
    for i in range(7):
        _image(setup[1] / f"100_{i}.png")
    args = _report_args(setup, [("100", "2026-10-04", "A")])
    first = flows._read_images(args)["fingerprint"]
    os.utime(setup[1] / "100_0.png", (time.time() - 20, time.time() - 20))
    Image.new("RGB", (24, 24), "blue").save(setup[1] / "100_6.png")
    os.utime(setup[1] / "100_6.png", (time.time() - 20, time.time() - 20))
    args = _report_args(setup, [("100", "2026-10-04", "A")])
    assert flows._read_images(args)["fingerprint"] == first
    Image.new("RGB", (24, 24), "blue").save(setup[1] / "100_0.png")
    os.utime(setup[1] / "100_0.png", (time.time() - 20, time.time() - 20))
    assert flows._read_images(args)["fingerprint"] != first


def test_report_batch_allows_manual_date_correction_and_does_not_match_ot_inside_dates(setup):
    _image(setup[1] / "100_2026-10-05_a.png")
    args = _report_args(setup, [("100", "2026-10-04", "A"), ("2026", "2026-10-05", "B")])
    result = flows._read_images(args)
    assert result["preview"][0]["candidates"] == ["100_2026-10-05_a.png"]
    assert result["preview"][0]["images"] == []
    assert result["preview"][1]["candidates"] == []
    args = _report_args(setup, [("100", "2026-10-04", "A")], photo_selections={"0": ["100_2026-10-05_a.png"]})
    assert flows._read_images(args)["ready"]
    args["field_mappings"]["OT"] = []
    with pytest.raises(ValueError, match="mapeo"):
        flows._read_images(args)
    with pytest.raises(ValueError, match="no contiene filas"):
        flows._read_images(_report_args(setup, []))


def test_report_batch_pdf_has_exactly_one_page_per_excel_row_and_persistent_dedup(setup):
    from backend.handlers import templates

    rows = [(str(i), "2026-10-04", f"Dirección {i}") for i in range(100, 120)]
    args = _report_args(setup, rows)
    for ot, _, _ in rows:
        for i in range(7):
            _image(setup[1] / f"{ot}_{i}.png")
    graph = _report_graph(setup, args)
    handlers = {"flows_read_images": flows._read_images, "flows_render_pdf": flows._render_pdf,
                "template_get": templates.template_get, "templates_list": templates.templates_list}
    runner = FlowRunner(setup[0], handlers.get)
    flow = setup[0].create("Reportes consolidados", graph=graph)
    done = _execute(setup[0], runner, flow)
    assert done["status"] == "success", done["steps"]
    saved = Path(done["steps"][-1]["output"]["saved_path"])
    with fitz.open(saved) as document:
        assert len(document) == 20
        for index, page in enumerate(document):
            assert f"Dirección {100 + index}" in page.get_text()
            assert page.get_images()
    restarted = FlowStore(setup[0]._flows_path, setup[0]._runs_path)
    assert not FlowRunner(restarted, handlers.get).ready_to_start(restarted.get(flow["id"]))
    assert _execute(setup[0], runner, setup[0].get(flow["id"]))["steps"][-1]["status"] == "skipped"
    changed = [(ot, day, f"Corregida {address}") for ot, day, address in rows]
    _report_args(setup, changed)
    assert runner.ready_to_start(setup[0].get(flow["id"]))
    assert _execute(setup[0], runner, setup[0].get(flow["id"]))["status"] == "success"
    assert len(list(setup[2].glob("*.pdf"))) == 2
    _report_args(setup, rows)
    assert not runner.ready_to_start(setup[0].get(flow["id"]))
    assert len(list(setup[2].glob("*.pdf"))) == 2


def test_report_batch_render_blocks_changed_photos_and_does_not_publish_wrong_page_count(setup, monkeypatch):
    from backend.utils import pdf_html

    _image(setup[1] / "100_a.png")
    source = flows._read_images(_report_args(setup, [("100", "2026-10-04", "A")]))
    params = {**source, "template_name": "report.html"}
    called = []
    with fitz.open() as document:
        document.new_page()
        document.new_page()
        wrong_pdf = document.tobytes()
    monkeypatch.setattr(pdf_html, "write_pdf_sanitized", lambda html: (called.append(html), wrong_pdf)[1])
    with pytest.raises(ValueError, match="se esperaban 1"):
        flows._render_pdf(params)
    assert not Path(params["output_path"]).exists()
    Image.new("RGB", (24, 24), "blue").save(setup[1] / "100_a.png")
    assert flows._render_pdf(params)["ready"] is False
    assert len(called) == 1


@pytest.mark.parametrize("target", ["https://other.example/end", "https://api.github.com:8443/end", "http://api.github.com/end"])
def test_redirect_removes_custom_credentials_when_origin_changes(monkeypatch, target):
    from backend.core.flows.http_guard import FlowRedirectHandler

    monkeypatch.setattr("backend.core.flows.http_guard.assert_allowed_url", lambda url: None)
    req = urllib.request.Request("https://api.github.com/start", headers={
        "X-Api-Key": "secret", "Cookie": "session=secret", "X-Custom-Credential": "secret", "Accept": "application/json",
    })
    req.add_unredirected_header("X-Internal-Key", "secret")
    redirected = FlowRedirectHandler(frozenset({"api.github.com"})).redirect_request(req, None, 302, "Found", {}, target)
    for bucket in (redirected.headers, redirected.unredirected_hdrs):
        assert not any(key.lower() in {"x-api-key", "cookie", "x-custom-credential", "x-internal-key"} for key in bucket)
    assert redirected.headers["Accept"] == "application/json"


def test_redirect_does_not_send_bearer_to_another_port_or_allowed_host(monkeypatch):
    from backend.core.flows.http_guard import FlowRedirectHandler

    monkeypatch.setattr("backend.core.flows.http_guard.assert_allowed_url", lambda url: None)
    req = urllib.request.Request("https://api.github.com/start", headers={"Authorization": "Bearer secret"})
    handler = FlowRedirectHandler(frozenset({"api.github.com", "other.example"}))
    for target in ("https://api.github.com:8443/end", "https://other.example/end"):
        redirected = handler.redirect_request(req, None, 302, "Found", {}, target)
        assert not redirected.has_header("Authorization")


def test_redirect_preserves_custom_headers_on_same_origin(monkeypatch):
    from backend.core.flows.http_guard import FlowRedirectHandler

    monkeypatch.setattr("backend.core.flows.http_guard.assert_allowed_url", lambda url: None)
    req = urllib.request.Request("https://api.github.com/start", headers={"X-Api-Key": "secret"})
    redirected = FlowRedirectHandler(frozenset({"api.github.com"})).redirect_request(
        req, None, 302, "Found", {}, "https://api.github.com:443/end",
    )
    assert redirected.headers["X-api-key"] == "secret"


@pytest.mark.parametrize("template", sorted(p.relative_to(Path(__file__).resolve().parents[1] / "backend/templates").as_posix()
                                          for p in (Path(__file__).resolve().parents[1] / "backend/templates").rglob("*.html")))
def test_consolidated_batch_supports_every_bundled_template_with_real_pdf(setup, template):
    profile = flows._batch_template_profile(template)
    field = next((key for key in ("NOMBRE", "cliente", "header.cs", "header.estacion", "cuadrante", "CENTRO", "ZONAL")
                  if key in profile["fields"]), profile["fields"][-1])
    args = _report_args(setup, [("100", "2026-10-04", "REGISTRO ALFA"), ("101", "2026-10-04", "REGISTRO BETA")])
    args["report_template"] = template
    args["field_mappings"][field] = "Dirección"
    for required in profile["required_fields"]:
        args["field_mappings"][required] = "Dirección"
    for ot in ("100", "101"):
        for i in range(6):
            _image(setup[1] / f"{ot}_{i}.png")
    args["images_per_panel"] = 6
    source = flows._read_images(args)
    assert source["ready"], source
    assert source["template_name"] == template
    assert source["image_limit"] == profile["image_limit"]
    result = flows._render_pdf({**source, "template_name": template})
    with fitz.open(result["saved_path"]) as pdf:
        assert len(pdf) >= 2
        text = "".join(page.get_text() for page in pdf)
        assert "REGISTRO ALFA" in text and "REGISTRO BETA" in text, template
        assert text.index("REGISTRO ALFA") < text.index("REGISTRO BETA")
        if template == "technical_reports/informe_tecnico.html":
            assert "OCTUBRE" in text
        if template == "report.html":
            assert len(pdf) == 2
    assert flows._render_pdf({**source, "template_name": template})["reused"]


def test_template_choice_and_content_invalidate_batch_and_legacy_fixed_renderer_follows_choice(setup):
    from backend.handlers import templates

    _image(setup[1] / "100_a.png")
    args = _report_args(setup, [("100", "2026-10-04", "A")])
    args["report_template"] = "emergencias.html"
    graph = _report_graph(setup, args)
    captured = []
    def handler(params):
        captured.append(params["template_name"])
        return {"saved_path": str(setup[2] / "salida.pdf")}
    handlers = {"flows_read_images": flows._read_images, "flows_render_pdf": handler,
                "template_get": templates.template_get, "templates_list": templates.templates_list}
    runner = FlowRunner(setup[0], handlers.get)
    flow = setup[0].create("Todas las plantillas", graph=graph)
    assert _execute(setup[0], runner, flow)["status"] == "success"
    assert captured == ["emergencias.html"]
    assert not runner.ready_to_start(setup[0].get(flow["id"]))
    graph["nodes"][0]["config"]["interval_minutes"] = 2
    flow = setup[0].update(flow["id"], graph=graph)
    assert not runner.ready_to_start(flow)
    original = templates.template_get
    handlers["template_get"] = lambda params: {"content": original(params)["content"] + "<!-- actualización -->"}
    assert runner.ready_to_start(setup[0].get(flow["id"]))
    handlers["template_get"] = original
    graph["nodes"][1]["config"]["args"]["report_template"] = "aniegos villa.html"
    changed = setup[0].update(flow["id"], graph=graph)
    assert runner.ready_to_start(changed)
    assert _execute(setup[0], runner, changed)["status"] == "success"
    assert captured == ["emergencias.html", "aniegos villa.html"]
    with pytest.raises(ValueError, match="Selecciona una plantilla"):
        flows._batch_template_profile("../report.html")


def test_certificate_batch_ignores_saved_photos_and_preserves_service_markers(setup, monkeypatch):
    from backend.utils import pdf_html

    args = _report_args(setup, [("100", "2026-10-04", "Cliente")], photo_selections={"0": ["100_a.png"]})
    args["report_template"] = "certificados-sjl-blanco.html"
    _image(setup[1] / "100_a.png", stable=False)
    source = flows._read_images(args)
    assert source["ready"]
    assert source["contexts"][0]["images"] == []
    source["contexts"][0]["data"].update(A="NO", B="X", C="0", D="Sí")
    captured = []
    with fitz.open() as document:
        document.new_page()
        pdf = document.tobytes()
    monkeypatch.setattr(pdf_html, "write_pdf_sanitized", lambda html: captured.append(html) or pdf)
    flows._render_pdf({**source, "template_name": args["report_template"]})
    assert "<b>NO</b>" in captured[0] and "<b>X</b>" in captured[0]
    assert "<b>0</b>" in captured[0] and "<b>Sí</b>" in captured[0]


def test_ficha_batch_maps_nested_fields_and_json_lists_without_parsing_plain_text(setup, monkeypatch):
    from backend.utils import pdf_html

    args = _report_args(setup, [("100", "2026-10-04", "A")])
    args["report_template"] = "fichas_tecnicas/ficha_tecnica.html"
    source = flows._read_images(args)
    data = source["contexts"][0]["data"]
    data.update(cliente="[Cliente de prueba]", personal_tecnico='["Técnico Alfa"]',
                productos='[{"producto":"PRODUCTO ALFA","cantidad":"2"}]', **{"obs_rec.observacion_a": "OBSERVACION ALFA"})
    captured = []
    with fitz.open() as document:
        document.new_page()
        pdf = document.tobytes()
    monkeypatch.setattr(pdf_html, "write_pdf_sanitized", lambda html: captured.append(html) or pdf)
    params = {**source, "template_name": args["report_template"]}
    flows._render_pdf(params)
    assert all(value in captured[0] for value in ("[Cliente de prueba]", "Técnico Alfa", "PRODUCTO ALFA", "OBSERVACION ALFA"))
    data["productos"] = '{"producto":"no es lista"}'
    params["output_path"] = str(setup[2] / "invalido.pdf")
    with pytest.raises(ValueError, match="lista JSON"):
        flows._render_pdf(params)
    assert not Path(params["output_path"]).exists()


def test_batch_template_photo_capacity_matches_native_layout():
    assert flows._batch_template_profile("emergencias.html")["image_limit"] == 4
    assert flows._batch_template_profile("panel-volanteo.html")["image_limit"] == 4
    assert flows._batch_template_profile("report.html")["image_limit"] == 6
    assert flows._batch_template_profile("format_reservorios.html")["image_limit"] == 6
    assert flows._batch_template_profile("certificados-sjl-blanco.html")["image_limit"] == 0
