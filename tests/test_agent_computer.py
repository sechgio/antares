import json
import sys
import threading
import time

import pytest

from backend.core.agent import (
    agent,
    agent_chat,
    agent_tools,
    computer_desktop,
    computer_files,
    computer_shell,
    resource_grants,
    task_plan,
)
from backend.core.agent.cancel import RunCancelled, _CancelEvent
from backend.core.exceptions import ValidationError
from backend.handlers import agent_internal


@pytest.fixture()
def store(tmp_path, monkeypatch):
    instance = agent.AgentStore(tmp_path / "agent")
    monkeypatch.setattr(agent, "get_agent_store", lambda: instance)
    monkeypatch.setattr(agent_internal, "_resource_locks", {})
    monkeypatch.setattr(agent_internal, "_native_leases", {})
    return instance


def _run(store, name, **args):
    return agent_tools.run(name, args, store, "s1")


def test_computer_tools_are_registered_with_their_permission_level():
    specs = {s["name"]: s for s in agent_chat.tool_specs()}
    for name in ("fs_list", "fs_read", "fs_search", "task_plan"):
        assert specs[name]["gated"] is False
        assert specs[name]["module"] == "computer"
    for name in ("fs_write", "fs_edit", "shell_run", "desktop_observe", "desktop_click", "desktop_type",
                 "desktop_key", "desktop_scroll", "desktop_launch", "desktop_focus"):
        assert specs[name]["gated"] is True
        assert name in agent_chat.gated_methods()


def test_workspace_write_read_edit_and_search_round_trip(store):
    saved = _run(store, "fs_write", path="notas/informe.md", content="# Título\nlínea dos\nfin")
    root = store.drafts_dir("s1")
    assert saved["saved_path"] == str(root / "notas" / "informe.md")
    read = _run(store, "fs_read", path="notas/informe.md", offset=2, limit=1)
    assert read["content"] == "2\tlínea dos" and read["total_lines"] == 3 and read["next_offset"] == 3
    assert _run(store, "fs_edit", path=saved["saved_path"], old="línea dos", new="línea 2")["replacements"] == 1
    assert (root / "notas" / "informe.md").read_text(encoding="utf-8") == "# Título\nlínea 2\nfin"
    hits = _run(store, "fs_search", pattern="LÍNEA \\d")["hits"]
    assert hits == [{"file": saved["saved_path"], "line": 2, "text": "línea 2"}]
    listing = _run(store, "fs_list")
    assert listing["workspace"] == str(root) and [e["name"] for e in listing["entries"]] == ["notas"]


def test_results_fit_the_runtime_budget_and_paginate(store):
    _run(store, "fs_write", path="largo.txt", content="\n".join(f"fila {i} " + "x" * 80 for i in range(2000)))
    first = _run(store, "fs_read", path="largo.txt")
    assert len(json.dumps(first, ensure_ascii=False)) <= agent._MAX_TOOL_RESULT_CHARS
    following = _run(store, "fs_read", path="largo.txt", offset=first["next_offset"])
    assert following["content"].startswith(f"{first['next_offset']}\tfila {first['next_offset'] - 1} ")
    noisy = computer_files.fit({"stdout": "y" * 50_000, "exit_code": 0, "items": list(range(5000))})
    assert len(json.dumps(noisy)) <= 5_600 and noisy["exit_code"] == 0 and noisy["truncated"] is True


def test_write_refuses_existing_files_without_overwrite_and_ambiguous_edits(store):
    _run(store, "fs_write", path="a.txt", content="x x")
    with pytest.raises(ValueError, match="overwrite"):
        _run(store, "fs_write", path="a.txt", content="nuevo")
    with pytest.raises(ValueError, match="2 veces"):
        _run(store, "fs_edit", path="a.txt", old="x", new="y")
    assert _run(store, "fs_edit", path="a.txt", old="x", new="y", replace_all=True)["replacements"] == 2
    with pytest.raises(ValueError, match="No se encontró"):
        _run(store, "fs_edit", path="a.txt", old="zzz", new="y")


def test_paths_outside_the_workspace_need_a_grant(store, tmp_path):
    outside = tmp_path / "privado"
    outside.mkdir()
    (outside / "secreto.txt").write_text("dato", encoding="utf-8")
    with pytest.raises(ValueError, match="no está autorizad"):
        _run(store, "fs_read", path=str(outside / "secreto.txt"))
    with pytest.raises(ValueError, match="no está autorizado"):
        _run(store, "fs_write", path=str(outside / "nuevo.txt"), content="x")
    with pytest.raises(ValueError, match=r"'\.\.'"):
        _run(store, "fs_read", path="../agent/approvals.json")
    store.add_grants("s1", [resource_grants.folder_record(str(outside), None)])
    assert _run(store, "fs_read", path=str(outside / "secreto.txt"))["content"] == "1\tdato"
    assert _run(store, "fs_write", path=str(outside / "nuevo.txt"), content="hola")["replaced"] is False
    assert [e["name"] for e in _run(store, "fs_list", path=str(outside))["entries"]] == ["nuevo.txt", "secreto.txt"]


def test_word_documents_are_written_read_and_edited(store):
    docx = pytest.importorskip("docx")
    path = _run(store, "fs_write", path="carta.docx", content="# Aviso\nEstimado cliente:\nSaludos")["saved_path"]
    assert [p.text for p in docx.Document(path).paragraphs] == ["Aviso", "Estimado cliente:", "Saludos"]
    assert "2\tEstimado cliente:" in _run(store, "fs_read", path="carta.docx")["content"]
    assert _run(store, "fs_edit", path="carta.docx", old="cliente", new="vecino")["replacements"] == 1
    assert docx.Document(path).paragraphs[1].text == "Estimado vecino:"


def test_write_approval_binds_the_current_file_revision(store):
    _run(store, "fs_write", path="plan.txt", content="v1")
    path = str(store.drafts_dir("s1") / "plan.txt")
    before = agent_internal._intent("s1", "fs_edit", {"path": "plan.txt", "old": "v1", "new": "v2"})
    assert before["resources"][0]["path"] == path and before["resources"][0]["sha256"]
    (store.drafts_dir("s1") / "plan.txt").write_text("cambiado", encoding="utf-8")
    after = agent_internal._intent("s1", "fs_edit", {"path": "plan.txt", "old": "v1", "new": "v2"})
    assert after["resources"] != before["resources"]
    fresh = agent_internal._intent("s1", "fs_write", {"path": "nuevo.txt", "content": "x"})
    assert fresh["resources"] == [{"path": str(store.drafts_dir("s1") / "nuevo.txt"), "exists": False}]
    with pytest.raises(ValidationError, match="no está autorizado"):
        agent_internal._intent("s1", "fs_write", {"path": "C:\\Windows\\x.txt", "content": "x"})


@pytest.mark.skipif(sys.platform != "win32", reason="PowerShell")
def test_shell_runs_powershell_in_the_workspace(store):
    out = _run(store, "shell_run", command="Write-Output ('ñandú ' + (2+3)); Get-Location | % Path; exit 3")
    assert out["exit_code"] == 3
    assert out["stdout"].splitlines() == ["ñandú 5", str(store.drafts_dir("s1"))]
    timed = _run(store, "shell_run", command="Start-Sleep -Seconds 20", timeout_s=1)
    assert "superó 1 s" in timed["error"] and timed["duration_s"] < 10


@pytest.mark.skipif(sys.platform != "win32", reason="PowerShell")
def test_shell_cancellation_kills_the_command(store):
    token = _CancelEvent()
    threading.Timer(1.0, token.cancel).start()
    started = time.monotonic()
    with pytest.raises(RunCancelled):
        agent_tools.run("shell_run", {"command": "Start-Sleep -Seconds 30"}, store, "s1", token)
    assert time.monotonic() - started < 10


@pytest.mark.skipif(sys.platform != "win32", reason="PowerShell")
def test_shell_reports_output_while_the_command_runs(store):
    token = _CancelEvent()
    seen = []
    worker = threading.Thread(target=lambda: seen.append(agent_tools.run(
        "shell_run", {"command": "'uno'; 'dos'; Start-Sleep -Seconds 3; 'tres'"}, store, "s1", token)))
    worker.start()
    deadline = time.monotonic() + 10
    while "dos" not in token.progress and time.monotonic() < deadline:
        time.sleep(0.05)
    assert token.progress == "uno\ndos\n" and worker.is_alive()
    worker.join(15)
    assert token.progress == "uno\ndos\ntres\n" and seen[0]["stdout"] == "uno\ndos\ntres\n"


def test_cancel_event_keeps_the_start_of_long_progress():
    token = _CancelEvent()
    token.report("a" * 70_000)
    token.report("b")
    assert token.progress == "a" * 64_000


def test_shell_rejects_unauthorized_working_folders(store, tmp_path):
    with pytest.raises(ValueError, match="no está autorizada"):
        computer_shell.run({"command": "dir", "cwd": str(tmp_path)}, {}, store.drafts_dir("s1"))


def test_task_plan_requires_evidence_to_close_a_step():
    with pytest.raises(ValueError, match="evidencia"):
        task_plan.update({"goal": "g", "steps": [{"title": "Crear archivo", "status": "done"}]})
    out = task_plan.update({"goal": "g", "steps": [
        {"title": "Crear archivo", "status": "done", "evidence": "fs_read muestra 3 líneas"},
        {"title": "Abrir web", "status": "in_progress"},
    ]})
    assert out == {"recorded": True, "done": 1, "total": 2, "remaining": ["Abrir web"], "next": "Sigue con: Abrir web"}
    closed = task_plan.update({"goal": "g", "steps": [{"title": "a", "status": "done", "evidence": "visto"}]})
    assert closed["remaining"] == [] and "comprueba el objetivo" in closed["next"]


def test_desktop_keys_and_coordinates_are_validated():
    assert computer_desktop._vk_for("Enter") == 0x0D and computer_desktop._vk_for("a") == ord("A")
    assert computer_desktop._vk_for("F5") == 0x74
    with pytest.raises(ValueError, match="Tecla desconocida"):
        computer_desktop._vk_for("hiper")
    with pytest.raises(ValueError, match="coordenada x"):
        computer_desktop._physical(True, "x")
    with pytest.raises(ValueError, match="no disponible"):
        computer_desktop.run("desktop_teleport", {}, None)  # type: ignore[arg-type]


@pytest.mark.skipif(sys.platform != "win32", reason="Escritorio de Windows")
def test_desktop_observe_returns_a_scaled_capture_and_windows(store):
    out = computer_desktop.observe(store.drafts_dir("s1"), elements=False)
    assert out["screen"]["width"] <= 1280 and out["image"]["mime"] == "image/jpeg"
    assert out["image"]["path"].startswith(str(store.drafts_dir("s1")) + ".screens")
    assert isinstance(out["windows"], list)
    assert json.dumps(out)


def test_desktop_dispatch_requires_an_approval(store):
    out = agent_internal.HANDLERS["agent_internal_dispatch"](
        {"session_id": "s1", "call_id": "c1", "name": "desktop_click", "params": {"x": 1, "y": 1}})
    assert "aprobación" in json.loads(out["result"])["error"]
    assert {"fs_write", "fs_edit"} == computer_files.WRITE_TOOLS
