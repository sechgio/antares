"""Retirada de Flujos: borrado atribuible, pendientes explícitos e idempotencia."""

from __future__ import annotations

import json
import os
import time

import pytest

from backend.core.agent import flows_retirement


def _iso(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ts)) + ".000000Z"


@pytest.fixture
def profile(tmp_path):
    flows_dir = tmp_path / "flows"
    flows_dir.mkdir()
    out = tmp_path / "salida"
    out.mkdir()
    finished = time.time() - 60
    proven = out / "reportes-a.pdf"
    proven.write_bytes(b"%PDF-1.7 proven")
    os.utime(proven, (finished - 5, finished - 5))
    edited = out / "reportes-b.pdf"
    edited.write_bytes(b"%PDF-1.7 edited later")
    os.utime(edited, (finished + 30, finished + 30))
    untracked = out / "artefacto.pdf"
    untracked.write_bytes(b"%PDF artifact")
    foreign = out / "ajeno.pdf"
    foreign.write_bytes(b"%PDF ajeno")
    flows = {"f1": {"id": "f1", "source_artifacts": {"fp": [str(untracked)]}}}
    runs = {"r1": {"id": "r1", "flow_id": "f1", "finished_at": _iso(finished), "graph": {"nodes": [
        {"id": "pdf", "kind": "tool_call", "config": {"method": "flows_render_pdf"}},
    ]}, "steps": [
        {"node_id": "pdf", "kind": "tool_call", "status": "success",
         "started_at": _iso(finished - 10), "finished_at": _iso(finished),
         "output": {"saved_paths": [str(proven), str(edited)]}},
        {"status": "error", "finished_at": _iso(finished), "output": {"saved_path": str(foreign)}},
        {"node_id": "pdf", "kind": "tool_call", "status": "success",
         "started_at": _iso(finished - 10), "finished_at": _iso(finished),
         "output": {"saved_path": str(out / "ya-borrado.pdf")}},
    ]}}
    (flows_dir / "flows.json").write_text(json.dumps(flows), encoding="utf-8")
    (flows_dir / "flow_runs.json").write_text(json.dumps(runs), encoding="utf-8")
    (flows_dir / "flows.paths-key").write_text("00", encoding="ascii")
    return tmp_path, flows_dir, proven, edited, untracked, foreign


def test_deletes_only_proven_outputs_and_flows_state(profile):
    root, flows_dir, proven, edited, untracked, foreign = profile
    tasks: list[str] = []
    result = flows_retirement.retire_flows(flows_dir, root / "marker.json", tasks.append, lambda: False)

    assert result["status"] == "completed"
    assert tasks == ["AntaresFlow-f1"]
    assert result["deleted"] == [str(proven)]
    assert not proven.exists()
    assert edited.exists() and untracked.exists() and foreign.exists()
    assert {p["path"]: p["reason"] for p in result["pending"]} == {
        str(edited): "modificado después de la ejecución",
        str(untracked): "sin ejecución registrada que lo generara",
    }
    assert not flows_dir.exists()
    assert json.loads((root / "marker.json").read_text(encoding="utf-8")) == result


def test_completed_marker_makes_retirement_idempotent(profile):
    root, flows_dir, *_ = profile
    marker = root / "marker.json"
    first = flows_retirement.retire_flows(flows_dir, marker, lambda name: None, lambda: False)
    flows_dir.mkdir()
    (flows_dir / "flows.json").write_text("{}", encoding="utf-8")
    second = flows_retirement.retire_flows(flows_dir, marker, lambda name: pytest.fail("no repetir"), lambda: False)
    assert second == first
    assert flows_dir.exists()


def test_waits_while_an_old_scheduled_run_is_alive(profile):
    root, flows_dir, proven, *_ = profile
    result = flows_retirement.retire_flows(flows_dir, root / "marker.json", lambda name: pytest.fail("no borrar"), lambda: True)
    assert result == {"status": "deferred"}
    assert proven.exists() and flows_dir.exists()
    assert not (root / "marker.json").exists()


def test_missing_flows_folder_completes_without_effects(tmp_path):
    result = flows_retirement.retire_flows(tmp_path / "flows", tmp_path / "marker.json",
                                           lambda name: pytest.fail("sin tareas"), lambda: False)
    assert result["status"] == "completed"
    assert result["deleted"] == [] and result["pending"] == [] and result["tasks"] == []


def test_manifest_failure_preserves_the_source_state(profile, monkeypatch):
    root, flows_dir, _, edited, untracked, _ = profile
    marker = root / "marker.json"
    write = flows_retirement.atomic_write_json
    monkeypatch.setattr(flows_retirement, "atomic_write_json", lambda *args: (_ for _ in ()).throw(OSError("Sin espacio")))
    with pytest.raises(OSError, match="Sin espacio"):
        flows_retirement.retire_flows(flows_dir, marker, lambda name: None, lambda: False)
    assert flows_dir.exists()
    monkeypatch.setattr(flows_retirement, "atomic_write_json", write)
    result = flows_retirement.retire_flows(flows_dir, marker, lambda name: None, lambda: False)
    assert result["runs"] == 1
    assert {p["path"] for p in result["pending"]} == {str(edited), str(untracked)}


def test_crash_after_state_deletion_recovers_the_saved_manifest(profile, monkeypatch):
    root, flows_dir, proven, edited, untracked, _ = profile
    marker = root / "marker.json"
    write = flows_retirement.atomic_write_json

    def fail_completion(path, value):
        if value["status"] == "completed":
            raise OSError("fallo del marcador final")
        write(path, value)

    monkeypatch.setattr(flows_retirement, "atomic_write_json", fail_completion)
    with pytest.raises(OSError, match="marcador final"):
        flows_retirement.retire_flows(flows_dir, marker, lambda name: None, lambda: False)
    assert not flows_dir.exists()
    monkeypatch.setattr(flows_retirement, "atomic_write_json", write)
    result = flows_retirement.retire_flows(flows_dir, marker, lambda name: pytest.fail("no repetir tareas"), lambda: False)
    assert result["runs"] == 1 and result["deleted"] == [str(proven)]
    assert {p["path"] for p in result["pending"]} == {str(edited), str(untracked)}
    assert result["status"] == "completed"


def test_failed_os_task_keeps_state_and_is_retried(profile):
    root, flows_dir, proven, *_ = profile
    marker = root / "marker.json"

    def fail_task(name):
        raise OSError("acceso denegado")

    result = flows_retirement.retire_flows(flows_dir, marker, fail_task, lambda: False)
    assert result["status"] == "deferred"
    assert flows_dir.exists() and proven.exists()
    assert result["pending_tasks"] == ["AntaresFlow-f1"]
    result = flows_retirement.retire_flows(flows_dir, marker, lambda name: None, lambda: False)
    assert result["status"] == "completed" and not flows_dir.exists()


def test_crash_after_an_output_delete_keeps_its_identity_in_the_journal(profile, monkeypatch):
    root, flows_dir, proven, edited, untracked, _ = profile
    marker = root / "marker.json"
    write = flows_retirement.atomic_write_json

    def fail_output_checkpoint(path, value):
        if value["deleted"]:
            raise OSError("fallo después del primer PDF")
        write(path, value)

    monkeypatch.setattr(flows_retirement, "atomic_write_json", fail_output_checkpoint)
    with pytest.raises(OSError, match="primer PDF"):
        flows_retirement.retire_flows(flows_dir, marker, lambda name: None, lambda: False)
    assert flows_dir.exists() and not proven.exists()
    monkeypatch.setattr(flows_retirement, "atomic_write_json", write)
    result = flows_retirement.retire_flows(flows_dir, marker, lambda name: None, lambda: False)
    assert result["deleted"] == [str(proven)]
    assert {p["path"] for p in result["pending"]} == {str(edited), str(untracked)}


def test_retirement_preserves_other_stores_and_documents(profile):
    root, flows_dir, *_ = profile
    siblings = {"ai-providers.json": b'{"provider":"configured"}',
                "mcp/servers.json": b'{"server":"kept"}', "connections/vault.bin": b"sealed-synthetic",
                "canvas/document.json": b'{"name":"kept"}'}
    for relative, content in siblings.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    result = flows_retirement.retire_flows(flows_dir, root / "marker.json", lambda name: None, lambda: False)
    assert result["status"] == "completed"
    assert all((root / relative).read_bytes() == content for relative, content in siblings.items())


@pytest.mark.parametrize("kind,method,suffix,content,reused", [
    ("tool_call", "evidencia_volanteo_render", ".docx", b"PK\x03\x04 documento", False),
    ("tool_call", "panel_aviso_corte_render_pdf", ".docx", b"PK\x03\x04 documento", False),
    ("tool_call", "flows_render_pdf", ".pdf", b"PK\x03\x04 documento", False),
    ("transform", "flows_render_pdf", ".pdf", b"%PDF-1.7 ajeno", False),
    ("code", "flows_render_pdf", ".pdf", b"%PDF-1.7 ajeno", False),
    ("tool_call", "canvas_get", ".pdf", b"%PDF-1.7 ajeno", False),
    ("tool_call", "flows_render_pdf", ".pdf", b"%PDF-1.7 reutilizado", True),
])
def test_retirement_preserves_non_pdf_and_unproven_outputs(tmp_path, kind, method, suffix, content, reused):
    output = tmp_path / f"salida{suffix}"
    output.write_bytes(content)
    finished = time.time() - 60
    os.utime(output, (finished - 5, finished - 5))
    flows_dir = tmp_path / "flows"
    flows_dir.mkdir()
    run = {"graph": {"nodes": [{"id": "n", "kind": kind, "config": {"method": method}}]}, "steps": [
        {"node_id": "n", "kind": kind, "status": "success",
         "started_at": _iso(finished - 10), "finished_at": _iso(finished),
         "output": {"saved_path": str(output), "reused": reused}},
    ]}
    (flows_dir / "flow_runs.json").write_text(json.dumps({"r": run}), encoding="utf-8")

    result = flows_retirement.retire_flows(flows_dir, tmp_path / "marker.json", lambda name: None, lambda: False)

    assert output.read_bytes() == content
    assert result["deleted"] == []
    assert [item["path"] for item in result["pending"]] == [str(output)]


@pytest.mark.parametrize("method", [
    "flows_render_pdf", "canvas_export_cmyk_pdf", "formatos_generate",
    "evidencia_volanteo_render", "panel_aviso_corte_render_pdf", "sellador_apply",
])
def test_retirement_accepts_the_recorded_pdf_producers(profile, method):
    root, flows_dir, proven, *_ = profile
    runs_path = flows_dir / "flow_runs.json"
    runs = json.loads(runs_path.read_text(encoding="utf-8"))
    runs["r1"]["graph"]["nodes"][0]["config"]["method"] = method
    runs_path.write_text(json.dumps(runs), encoding="utf-8")

    result = flows_retirement.retire_flows(flows_dir, root / "marker.json", lambda name: None, lambda: False)

    assert result["deleted"] == [str(proven)]
    assert not proven.exists()


def test_legacy_manifest_without_producer_evidence_preserves_its_outputs(profile):
    root, flows_dir, proven, *_ = profile
    marker = root / "marker.json"
    manifest = {"status": "retiring", "flows": 1, "runs": 1, "tasks": [], "remaining_tasks": [],
                "outputs": [{"path": str(proven), "finished": time.time(), "existed": True}],
                "deleted": [], "pending": []}
    marker.write_text(json.dumps(manifest), encoding="utf-8")

    result = flows_retirement.retire_flows(flows_dir, marker, lambda name: None, lambda: False)

    assert proven.exists()
    assert result["deleted"] == []
    assert [item["path"] for item in result["pending"]] == [str(proven)]


@pytest.mark.parametrize("missing", ["graph", "node_id", "kind", "started_at"])
def test_retirement_preserves_outputs_without_a_matching_recorded_tool(profile, missing):
    root, flows_dir, proven, *_ = profile
    runs_path = flows_dir / "flow_runs.json"
    runs = json.loads(runs_path.read_text(encoding="utf-8"))
    if missing == "graph":
        runs["r1"].pop("graph")
    else:
        runs["r1"]["steps"][0].pop(missing)
    runs_path.write_text(json.dumps(runs), encoding="utf-8")

    result = flows_retirement.retire_flows(flows_dir, root / "marker.json", lambda name: None, lambda: False)

    assert proven.exists()
    assert str(proven) not in result["deleted"]
    assert str(proven) in {item["path"] for item in result["pending"]}


def test_retirement_preserves_a_pdf_written_before_its_recorded_step(profile):
    root, flows_dir, proven, *_ = profile
    runs_path = flows_dir / "flow_runs.json"
    runs = json.loads(runs_path.read_text(encoding="utf-8"))
    runs["r1"]["steps"][0]["started_at"] = _iso(proven.stat().st_mtime + 1)
    runs_path.write_text(json.dumps(runs), encoding="utf-8")

    result = flows_retirement.retire_flows(flows_dir, root / "marker.json", lambda name: None, lambda: False)

    assert proven.exists()
    assert str(proven) not in result["deleted"]
    assert str(proven) in {item["path"] for item in result["pending"]}
