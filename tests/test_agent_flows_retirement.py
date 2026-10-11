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
    proven.write_bytes(b"%PDF proven")
    os.utime(proven, (finished - 5, finished - 5))
    edited = out / "reportes-b.pdf"
    edited.write_bytes(b"%PDF edited later")
    os.utime(edited, (finished + 30, finished + 30))
    untracked = out / "artefacto.pdf"
    untracked.write_bytes(b"%PDF artifact")
    foreign = out / "ajeno.pdf"
    foreign.write_bytes(b"%PDF ajeno")
    flows = {"f1": {"id": "f1", "source_artifacts": {"fp": [str(untracked)]}}}
    runs = {"r1": {"id": "r1", "flow_id": "f1", "finished_at": _iso(finished), "steps": [
        {"status": "success", "finished_at": _iso(finished), "output": {"saved_paths": [str(proven), str(edited)]}},
        {"status": "error", "finished_at": _iso(finished), "output": {"saved_path": str(foreign)}},
        {"status": "success", "finished_at": _iso(finished), "output": {"saved_path": str(out / "ya-borrado.pdf")}},
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
