import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from backend.core.agent import (
    agent,
    agent_chat,
    agent_tools,
    computer_desktop,
    computer_files,
    computer_jobs,
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
                 "desktop_key", "desktop_scroll", "desktop_launch", "desktop_focus", "shell_job_start", "shell_job_cancel"):
        assert specs[name]["gated"] is True
        assert name in agent_chat.gated_methods()
    assert specs["shell_job_status"]["gated"] is False
    assert "shell_job_status" not in agent_chat.gated_methods()


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


def test_edit_applies_several_edits_atomically_and_returns_a_numbered_snippet(store):
    _run(store, "fs_write", path="app.py", content="def a():\n    return 1\n\n\ndef b():\n    return 2\n")
    path = store.drafts_dir("s1") / "app.py"
    result = _run(store, "fs_edit", path="app.py", edits=[
        {"old": "return 1", "new": "return 10"}, {"old": "def b():\n    return 2", "new": "def b():\n    return 20"}])
    assert result["replacements"] == 2
    assert path.read_text(encoding="utf-8") == "def a():\n    return 10\n\n\ndef b():\n    return 20\n"
    assert result["snippet"].splitlines() == ["2\t    return 10", "3\t", "4\t", "5\tdef b():", "6\t    return 20"]
    with pytest.raises(ValueError, match="Edición 2: No se encontró"):
        _run(store, "fs_edit", path="app.py", edits=[{"old": "return 10", "new": "x"}, {"old": "zzz", "new": "y"}])
    assert "return 10" in path.read_text(encoding="utf-8")


def test_edit_matches_lf_fragments_in_crlf_files(store):
    path = store.drafts_dir("s1") / "win.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"uno\r\ndos\r\ntres\r\n")
    _run(store, "fs_read", path="win.txt")
    assert _run(store, "fs_edit", path="win.txt", old="uno\ndos", new="1\n2")["replacements"] == 1
    assert path.read_bytes() == b"1\r\n2\r\ntres\r\n"


def test_edit_and_overwrite_require_reading_the_current_revision(store):
    path = store.drafts_dir("s1") / "ajeno.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("v1", encoding="utf-8")
    with pytest.raises(ValueError, match=r"Lee ajeno\.txt con fs_read"):
        _run(store, "fs_edit", path="ajeno.txt", old="v1", new="v2")
    with pytest.raises(ValueError, match=r"Lee ajeno\.txt con fs_read"):
        _run(store, "fs_write", path="ajeno.txt", content="nuevo", overwrite=True)
    _run(store, "fs_read", path="ajeno.txt")
    assert _run(store, "fs_edit", path="ajeno.txt", old="v1", new="v2")["replacements"] == 1
    assert _run(store, "fs_edit", path="ajeno.txt", old="v2", new="v3")["replacements"] == 1
    path.write_text("cambiado fuera", encoding="utf-8")
    with pytest.raises(ValueError, match="cambió desde que lo leíste"):
        _run(store, "fs_edit", path="ajeno.txt", old="cambiado", new="x")
    assert path.read_text(encoding="utf-8") == "cambiado fuera"
    assert _run(store, "fs_read", path="ajeno.txt")["content"] == "1\tcambiado fuera"
    assert _run(store, "fs_edit", path="ajeno.txt", old="fuera", new="dentro")["replacements"] == 1


def test_edit_tolerates_trailing_whitespace_and_explains_numbered_fragments(store):
    _run(store, "fs_write", path="mod.py", content="def a():  \n    return 1\n\nfin\n")
    path = store.drafts_dir("s1") / "mod.py"
    assert _run(store, "fs_edit", path="mod.py", old="def a():\n    return 1 \n", new="def a():\n    return 2\n")[
        "replacements"] == 1
    assert path.read_text(encoding="utf-8") == "def a():\n    return 2\n\nfin\n"
    with pytest.raises(ValueError, match="quita el número de línea"):
        _run(store, "fs_edit", path="mod.py", old="2\t    return 2", new="x")


def test_search_supports_path_globs_context_and_file_counts(store):
    _run(store, "fs_write", path="src/pkg/mod.py", content="import os\nVALOR = 1\nprint(VALOR)\n")
    _run(store, "fs_write", path="src/notas.txt", content="VALOR en texto")
    _run(store, "fs_write", path="node_modules/dep/index.py", content="VALOR = 2")
    root = store.drafts_dir("s1")
    hits = _run(store, "fs_search", pattern="VALOR =", glob="src/**/*.py", context=1)["hits"]
    assert hits == [{"file": str(root / "src" / "pkg" / "mod.py"), "line": 2, "text": "VALOR = 1",
                     "before": ["import os"], "after": ["print(VALOR)"]}]
    assert _run(store, "fs_search", pattern="valor", glob="**/*.py", files_only=True)["hits"] == [
        {"file": str(root / "src" / "pkg" / "mod.py"), "matches": 2}]


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
    assert "código 3" in out["error"] and agent.result_failed(json.dumps(out))
    timed = _run(store, "shell_run", command="Start-Sleep -Seconds 20", timeout_s=1)
    assert "superó 1 s" in timed["error"] and timed["duration_s"] < 10


@pytest.mark.skipif(sys.platform != "win32", reason="PowerShell")
def test_shell_preserves_the_middle_of_long_output_and_scopes_paged_reads(store):
    out = _run(store, "shell_run", command="[Console]::Write(('a'*3000)+'CENTRO'+('b'*3000)); [Console]::Error.Write('error completo')")
    assert "CENTRO" not in out["stdout"]
    page = _run(store, "shell_output", output_id=out["output_id"], offset=3000, limit=6)
    assert page["content"] == "CENTRO" and page["next_offset"] == 3006
    assert page["total_chars"] == 6006
    assert _run(store, "shell_output", output_id=out["output_id"], stream="stderr")["content"] == "error completo"
    reloaded = agent.AgentStore(store.base_dir)
    assert agent_tools.run("shell_output", {"output_id": out["output_id"], "offset": 6000}, reloaded, "s1")["content"] == "b" * 6
    with pytest.raises(ValueError):
        agent_tools.run("shell_output", {"output_id": out["output_id"]}, store, "s2")
    with pytest.raises(ValueError):
        _run(store, "shell_output", output_id="../approvals")


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


@pytest.mark.skipif(sys.platform != "win32", reason="PowerShell")
def test_shell_job_runs_in_background_and_exposes_paged_output(store):
    job = _run(store, "shell_job_start", command="'uno'; Start-Sleep -Milliseconds 700; 'dos'", timeout_s=20)
    assert job["status"] == "running" and len(job["job_id"]) == 32
    finished = _wait_job(store, job["job_id"], {"exited"}, timeout=20)
    assert finished["exit_code"] == 0 and finished["output_id"] == job["job_id"]
    page = agent_tools.run("shell_output", {"output_id": job["output_id"]}, store, "s1")
    assert page["content"] == "uno\ndos\n"
    stderr_page = agent_tools.run("shell_output", {"output_id": job["output_id"], "stream": "stderr"}, store, "s1")
    assert stderr_page["content"] == ""
    with pytest.raises(ValueError, match="no existe"):
        agent_tools.run("shell_job_status", {"job_id": job["job_id"]}, store, "s2")


@pytest.mark.skipif(sys.platform != "win32", reason="PowerShell")
def test_shell_job_cancel_timeout_concurrency_and_cleanup(store):
    try:
        slow = _run(store, "shell_job_start", command="Start-Sleep -Seconds 30", timeout_s=60)
        cancelled = _run(store, "shell_job_cancel", job_id=slow["job_id"])
        assert cancelled["cancelled"] is True
        assert _wait_job(store, slow["job_id"], {"cancelled"}, timeout=15)["status"] == "cancelled"
        timed = _run(store, "shell_job_start", command="Start-Sleep -Seconds 10", timeout_s=1)
        assert _wait_job(store, timed["job_id"], {"timed_out"}, timeout=15)["timed_out"] is True
        first = _run(store, "shell_job_start", command="Start-Sleep -Seconds 10", timeout_s=30)
        second = _run(store, "shell_job_start", command="Start-Sleep -Seconds 10", timeout_s=30)
        with pytest.raises(ValueError, match="jobs en marcha"):
            _run(store, "shell_job_start", command="'tercero'", timeout_s=30)
        computer_jobs.cancel_session("s1")
        _wait_job(store, first["job_id"], {"cancelled"}, timeout=15)
        _wait_job(store, second["job_id"], {"cancelled"}, timeout=15)
        assert _run(store, "shell_job_status", job_id=first["job_id"])["status"] == "cancelled"
    finally:
        computer_jobs.kill_all()


def _wait_job(store, job_id, expected, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status = _run(store, "shell_job_status", job_id=job_id)
        if status["status"] in expected:
            return status
        time.sleep(0.05)
    raise AssertionError(f"El job {job_id} no llegó a {expected}")


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


def test_desktop_actions_from_different_sessions_do_not_overlap(store, monkeypatch):
    started = threading.Event()
    release = threading.Event()
    clicked = threading.Event()

    def observe(root, elements=True):
        started.set()
        assert release.wait(5)
        return {"observed": True}

    monkeypatch.setattr(computer_desktop, "observe", observe)
    monkeypatch.setattr(computer_desktop, "click", lambda *_: clicked.set() or {"clicked": True})
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(agent_tools.run, "desktop_observe", {}, store, "s1")
        assert started.wait(5)
        second = pool.submit(agent_tools.run, "desktop_click", {"x": 1, "y": 1}, store, "s2")
        try:
            assert not clicked.wait(0.2)
        finally:
            release.set()
        assert first.result(timeout=5) == {"observed": True}
        assert second.result(timeout=5) == {"clicked": True}


def test_desktop_stops_typing_when_the_turn_is_cancelled(store, monkeypatch):
    token = _CancelEvent()
    sent = []

    def send(*inputs):
        sent.extend(inputs)
        token.cancel()

    monkeypatch.setattr(computer_desktop, "_send", send)
    monkeypatch.setattr(computer_desktop, "_settled", lambda *_: {"typed": True})
    with pytest.raises(RunCancelled):
        agent_tools.run("desktop_type", {"text": "abcd"}, store, "s1", token)
    assert len(sent) == 2
    monkeypatch.setattr(computer_desktop, "observe", lambda *_: {"observed": True})
    assert _run(store, "desktop_observe") == {"observed": True}


def test_cancelled_desktop_action_does_not_execute_after_waiting(store, monkeypatch):
    started = threading.Event()
    release = threading.Event()
    clicked = threading.Event()
    token = _CancelEvent()

    def observe(root, elements=True):
        started.set()
        assert release.wait(5)
        return {"observed": True}

    monkeypatch.setattr(computer_desktop, "observe", observe)
    monkeypatch.setattr(computer_desktop, "click", lambda *_: clicked.set() or {})
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(agent_tools.run, "desktop_observe", {}, store, "s1")
        assert started.wait(5)
        second = pool.submit(agent_tools.run, "desktop_click", {"x": 1, "y": 1}, store, "s2", token)
        token.cancel()
        release.set()
        first.result(timeout=5)
        with pytest.raises(RunCancelled):
            second.result(timeout=5)
    assert not clicked.is_set()


def test_desktop_validates_all_shortcuts_before_sending_input(store, monkeypatch):
    sent = []
    monkeypatch.setattr(computer_desktop, "_send", lambda *inputs: sent.extend(inputs))
    with pytest.raises(ValueError, match="Tecla desconocida"):
        _run(store, "desktop_key", keys="ctrl+s hiper")
    assert sent == []


def test_path_status_reuses_workspace_and_grant_resolution(store, tmp_path):
    root = store.drafts_dir("s1")
    build = root / "build"
    build.mkdir(parents=True)
    out = build / "resultado.txt"
    out.write_text("ok", encoding="utf-8")
    status = computer_files.stat_path("build/resultado.txt", {}, root)
    assert status["exists"] is True and status["type"] == "file" and status["size"] == 2
    assert status["path"] == str(out)
    assert computer_files.stat_path("build/pendiente.txt", {}, root) == {
        "path": str(build / "pendiente.txt"), "exists": False,
    }
    outside = tmp_path / "otra"
    outside.mkdir()
    with pytest.raises(ValueError, match="autoriza"):
        computer_files.stat_path(str(outside / "nuevo.txt"), {}, root)
    store.add_grants("s1", [resource_grants.folder_record(str(outside), None)])
    assert computer_files.stat_path(str(outside / "nuevo.txt"), store.grants_for("s1"), root)["exists"] is False
    existing = outside / "existente.txt"
    existing.write_text("x", encoding="utf-8")
    with pytest.raises(ValueError, match="autoriza"):
        computer_files.stat_path(str(existing), {}, root)
    store.add_grants("s1", [resource_grants.grant_record(str(existing), None)])
    assert computer_files.stat_path(str(existing), store.grants_for("s1"), root)["exists"] is True
