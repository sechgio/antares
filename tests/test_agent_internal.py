import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress

import pytest

from backend.core.agent import agent
from backend.core.exceptions import NotFoundError, ValidationError
from backend.core.integrations import ai_providers, mcp_servers
from backend.handlers import agent_internal
from tests.agent_store_seed import seed_session


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("SKILLS_EXTERNAL_HOMES", str(tmp_path / "external-skills"))
    instance = agent.AgentStore(tmp_path)
    monkeypatch.setattr(agent, "get_agent_store", lambda: instance)
    monkeypatch.setattr(agent_internal, "_resource_locks", {})
    monkeypatch.setattr(agent_internal, "_native_leases", {})
    return instance


def test_file_preview_checks_grants_workspace_drafts_and_revocation(store, tmp_path):
    from backend.core.agent import resource_grants

    preview = agent_internal.HANDLERS["agent_internal_file_preview"]
    session = "preview-session"
    external = tmp_path / "private.txt"
    external.write_text("contenido autorizado", encoding="utf-8")
    params = {"session_id": session, "resource": str(external)}
    with pytest.raises(ValidationError, match="autorizado"):
        preview(params)
    store.add_grants(session, [resource_grants.grant_record(str(external), "request")])
    assert preview(params)["text"] == "contenido autorizado"
    with pytest.raises(ValidationError, match="autorizado"):
        preview({**params, "session_id": "otra-sesion"})
    store.revoke_grant(session, str(external))
    with pytest.raises(ValidationError, match="autorizado"):
        preview(params)
    workspace = tmp_path / "project"
    workspace.mkdir()
    (workspace / "nota.txt").write_text("proyecto", encoding="utf-8")
    store.add_grants(session, [resource_grants.folder_record(str(workspace), "request")])
    store.set_workspace(session, str(workspace))
    assert preview({"session_id": session, "resource": "nota.txt"})["text"] == "proyecto"
    draft = store.drafts_dir(session) / "resultado.txt"
    draft.parent.mkdir(parents=True, exist_ok=True)
    draft.write_text("borrador", encoding="utf-8")
    assert preview({"session_id": session, "resource": str(draft)})["text"] == "borrador"
    with pytest.raises(ValidationError):
        preview({"session_id": session, "resource": "../private.txt"})


def test_selected_file_preview_does_not_persist_a_grant(store, tmp_path):
    selected = tmp_path / "selected.txt"
    selected.write_text("adjunto pendiente", encoding="utf-8")
    result = agent_internal.HANDLERS["agent_internal_file_preview"]({"session_id": "s1", "selected_file": str(selected)})
    assert result["text"] == "adjunto pendiente"
    assert store.grants_for("s1") == {}


def _provider_info(provider, **config):
    return agent_internal.HANDLERS["agent_internal_provider"]({"provider": provider, **config})


def _dispatch(**params):
    return agent_internal.HANDLERS["agent_internal_dispatch"](params)


def _dispatch_result(call_id, session_id="s1"):
    return agent_internal.HANDLERS["agent_internal_dispatch_result"]({"session_id": session_id, "call_id": call_id})


def _wait_result(call_id, timeout=10, session_id="s1"):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        out = _dispatch_result(call_id, session_id)
        if out["result"] is not None:
            return out
        time.sleep(0.02)
    raise AssertionError(f"dispatch {call_id} no terminó")


@pytest.mark.parametrize("legacy", [False, True])
def test_subagent_uses_the_durable_runtime_route(store, monkeypatch, legacy):
    routes = []

    def chat(provider, model, messages, **kwargs):
        routes.append((provider, model))
        return {"text": "Revisé los datos solicitados", "calls": []}

    monkeypatch.setattr(agent_internal._agent_chat, "chat", chat)
    monkeypatch.setattr(agent, "get_agent_runner", lambda: agent.AgentRunner(store, lambda _: None))
    session_id = seed_session(store, "previous", provider="old-provider", model="old-model")["id"] if legacy else "durable-session"
    _dispatch(session_id=session_id, call_id="delegation", name="subagent_run", params={"task": "Revisa datos"},
              context={"subagent": {"id": "reader", "name": "Lector", "instructions": "Lee los datos",
                                    "tools": [], "enabled": [], "provider": "selected-provider", "model": "selected-model"}})
    receipt = json.loads(_wait_result("delegation", session_id=session_id)["result"])
    assert receipt["status"] == "done" and receipt["text"] == "Revisé los datos solicitados"
    assert routes == [("selected-provider", "selected-model")]


@pytest.mark.parametrize("profile_scoped", [False, True])
def test_subagent_reads_local_skills_without_gaining_effect_tools(store, monkeypatch, profile_scoped):
    home = store.base_dir / "configured-skills"
    monkeypatch.setenv("SKILLS_HOME", str(home))
    monkeypatch.delenv("ORBS_SHARED_HOME", raising=False)
    skill = (home / "reviewer" if profile_scoped else store.base_dir / "skills") / "pdf-review/SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text("---\nname: pdf-review\ndescription: Revisa PDFs\nallowed-tools: shell_run\n---\nRevisa cada firma.", encoding="utf-8")
    if profile_scoped:
        for scope in ("_shared", "coordinator"):
            other = home / scope / "pdf-review/SKILL.md"
            other.parent.mkdir(parents=True)
            other.write_text("---\nname: pdf-review\ndescription: Revisa PDFs\n---\nInstrucciones de otro origen", encoding="utf-8")
    calls = []

    def chat(provider, model, messages, **kwargs):
        available = {tool["name"] for tool in kwargs["tools"]}
        assert available == {"skills_list", "skills_read"}
        assert "skills_read" in kwargs["system"]
        calls.append(len(messages))
        if len(calls) == 1:
            return {"calls": [{"id": "list", "name": "skills_list", "params": {"query": "PDF"}}]}
        result = json.loads(messages[-1]["content"])
        if len(calls) == 2:
            assert [entry["location"] for entry in result["skills"]] == [str(skill)]
            return {"calls": [{"id": "read", "name": "skills_read", "params": {"skill_id": result["skills"][0]["id"]}}]}
        if len(calls) == 3:
            assert "Revisa cada firma" in result["content"]
            return {"calls": [{"id": "blocked", "name": "shell_run", "params": {"command": "exit 0"}}]}
        assert "no disponible" in result["error"]
        return {"text": "Leí la skill de revisión de firmas; no ejecuté comandos", "calls": []}

    monkeypatch.setattr(agent_internal._agent_chat, "chat", chat)
    monkeypatch.setattr(agent, "get_agent_runner", lambda: agent.AgentRunner(store, lambda _: None))
    _dispatch(session_id="durable-skills", call_id="skills-delegation", name="subagent_run", params={"task": "Revisa PDFs con skills"},
              context={"profile_id": "coordinator", "subagent": {"id": "reviewer", "name": "Revisor", "provider": "selected", "model": "model", "tools": None,
                                    "enabled": ["skills_list", "skills_read"]}})
    receipt = json.loads(_wait_result("skills-delegation", session_id="durable-skills")["result"])
    assert receipt["status"] == "done" and len(calls) == 4
    assert [(step["name"], step["status"]) for step in receipt["steps"]] == [
        ("skills_list", "done"), ("skills_read", "done"), ("shell_run", "failed")]


@pytest.mark.parametrize("profile_id", [None, "reader", "writer"])
def test_private_dispatch_scopes_skills_by_profile_across_sessions(store, monkeypatch, profile_id):
    home = store.base_dir / "configured-skills"
    monkeypatch.setenv("SKILLS_HOME", str(home))
    monkeypatch.delenv("ORBS_SHARED_HOME", raising=False)
    for scope in ("_shared", "reader", "writer"):
        skill = home / scope / "pdf-review/SKILL.md"
        skill.parent.mkdir(parents=True)
        skill.write_text(f"---\nname: pdf-review\ndescription: Revisa PDFs\n---\nOrigen: {scope}", encoding="utf-8")
    monkeypatch.setattr(agent, "get_agent_runner", lambda: agent.AgentRunner(store, lambda _: None))
    found_ids = []
    for session_id in ("first-chat", "second-chat"):
        context = {"profile_id": profile_id}
        _dispatch(session_id=session_id, call_id="list", name="skills_list",
                  params={"profile_id": "writer", "agent_id": "writer"}, context=context)
        catalog = json.loads(_wait_result("list", session_id=session_id)["result"])
        assert [entry["location"] for entry in catalog["skills"]] == [str(home / (profile_id or "_shared") / "pdf-review/SKILL.md")]
        skill_id = catalog["skills"][0]["id"]
        found_ids.append(skill_id)
        _dispatch(session_id=session_id, call_id="read", name="skills_read", params={"skill_id": skill_id}, context=context)
        page = json.loads(_wait_result("read", session_id=session_id)["result"])
        assert f"Origen: {profile_id or '_shared'}" in page["content"]
        assert store.grants_for(session_id) == {}
    assert found_ids[0] == found_ids[1]


@pytest.mark.parametrize("profile_id", [None, "reader"])
def test_private_dispatch_transports_actor_profile_independently_of_tool(store, monkeypatch, profile_id):
    runner = agent.AgentRunner(store, lambda _: None)
    monkeypatch.setattr(runner, "_execute", lambda call, token=None: json.dumps({"profile_id": call.get("profile_id")}))
    monkeypatch.setattr(agent, "get_agent_runner", lambda: runner)
    _dispatch(session_id="actor-context", call_id="drafts", name="drafts_list",
              params={"profile_id": "writer"}, context={"profile_id": profile_id})
    result = json.loads(_wait_result("drafts", session_id="actor-context")["result"])
    assert result["profile_id"] == profile_id


def test_tools_list_projects_backend_and_mcp_kinds(monkeypatch):
    monkeypatch.setattr(mcp_servers, "list_servers", lambda: [{"id": "srv"}])
    monkeypatch.setattr(
        agent_internal._agent_chat,
        "tool_specs",
        lambda: [
            {"name": "flows_list", "gated": False},
            {"name": "db_export", "gated": True},
            {"name": mcp_servers.agent_tool_name("srv", "search"), "gated": True},
        ],
    )
    tools = agent_internal.HANDLERS["agent_internal_tools"]({})["tools"]
    by_name = {t["name"]: t for t in tools}
    assert by_name["flows_list"]["kind"] == "backend"
    assert by_name["db_export"]["kind"] == "backend"
    assert by_name[mcp_servers.agent_tool_name("srv", "search")]["kind"] == "mcp"


def test_provider_wire_base_url_per_style(monkeypatch):
    monkeypatch.setattr(ai_providers, "get_config", lambda provider: None)
    # Ollama sirve /v1/chat/completions: el wire base conserva el /v1.
    ollama = _provider_info("ollama")
    assert ollama["base_url"].endswith("/v1")
    assert ollama["auth_type"] == "none" and ollama["api_key"] is None
    assert ollama["style"] == "openai_chat"
    for name in ("openai", "openrouter"):
        monkeypatch.setattr(ai_providers, "get_config", lambda p, k="sk-test": {"api_key": k})
        info = _provider_info(name)
        assert info["style"] == "openai_chat"
        assert info["base_url"].endswith("/v1") or info["base_url"].endswith("/api/v1")
        assert info["api_key"] == "sk-test"
    # Anthropic: el SDK añade /v1/messages, el wire base es la raíz.
    anthropic = _provider_info("anthropic")
    assert anthropic["style"] == "anthropic_messages"
    assert anthropic["base_url"] == "https://api.anthropic.com"
    assert anthropic["extra_headers"].get("anthropic-version")


def test_provider_requires_key_and_known_provider(monkeypatch):
    monkeypatch.setattr(ai_providers, "get_config", lambda provider: None)
    with pytest.raises(ValidationError):
        _provider_info("openai")
    with pytest.raises(ValidationError):
        _provider_info("proveedor-inexistente")


def test_approval_ensure_is_idempotent_per_call(store):
    params = {"session_id": "s1", "call_id": "c1", "method": "db_clear", "params": {}}
    first = agent_internal.HANDLERS["agent_internal_approval_ensure"](params)["approval"]
    again = agent_internal.HANDLERS["agent_internal_approval_ensure"](params)["approval"]
    assert first["id"] == again["id"]
    pending = agent_internal.HANDLERS["agent_internal_approvals_pending"]({"session_id": "s1"})["approvals"]
    assert [a["id"] for a in pending] == [first["id"]]
    decided = agent_internal.HANDLERS["agent_internal_approval_decide"](
        {"approval_id": first["id"], "approve": True}
    )["approval"]
    assert decided["status"] == "approved"
    with pytest.raises(ValidationError):
        agent_internal.HANDLERS["agent_internal_approval_decide"](
            {"approval_id": first["id"], "approve": False}
        )


def test_concurrent_approval_ensure_creates_one_approval(store, monkeypatch):
    barrier = threading.Barrier(2)
    lookup = store.approval_for_call

    def concurrent_lookup(session_id, call_id):
        found = lookup(session_id, call_id)
        with suppress(threading.BrokenBarrierError):
            barrier.wait(timeout=0.5)
        return found

    monkeypatch.setattr(store, "approval_for_call", concurrent_lookup)
    params = {"session_id": "s1", "call_id": "race", "method": "db_export", "params": {}}
    with ThreadPoolExecutor(max_workers=2) as workers:
        approvals = list(workers.map(lambda _: agent_internal._approval_ensure(params)["approval"], range(2)))
    assert len({a["id"] for a in approvals}) == 1
    assert len(store.pending_approvals("s1")) == 1


def test_approved_but_unused_approval_expires_before_dispatch(store, monkeypatch):
    monkeypatch.setattr(agent_internal._agent_chat, "gated_methods", lambda: ["db_export"])
    now = agent._now_ms()
    approval_id = _approve("s1", "expired-approved", "db_export", {})
    monkeypatch.setattr(agent, "_now_ms", lambda: now + agent._APPROVAL_TTL_MS + 1_000)
    result = _dispatch(session_id="s1", call_id="expired-approved", name="db_export", params={}, approval_id=approval_id)
    assert "error" in json.loads(result["result"])
    assert store.get_approval(approval_id)["status"] == "expired"


def test_approvals_deny_session(store):
    store.create_approval("s1", {"id": "c1", "name": "db_clear", "params": {}})
    store.create_approval("s1", {"id": "c2", "name": "db_export", "params": {}})
    store.create_approval("s2", {"id": "c3", "name": "db_clear", "params": {}})
    denied = agent_internal.HANDLERS["agent_internal_approvals_deny_session"]({"session_id": "s1"})["denied"]
    assert len(denied) == 2
    remaining = agent_internal.HANDLERS["agent_internal_approvals_pending"]({"session_id": "s2"})["approvals"]
    assert len(remaining) == 1


def test_approval_history_handler_and_grants(store):
    approval = store.create_approval("s1", {"id": "c1", "name": "db_export", "params": {"path": "C:/fuera"}})
    store.decide_approval(approval["id"], False)
    history = agent_internal.HANDLERS["agent_internal_approvals_history"]({"status": "denied"})["approvals"]
    assert [item["id"] for item in history] == [approval["id"]]
    assert history[0]["params"] == {"path": "C:/fuera"}
    with pytest.raises(ValidationError):
        agent_internal.HANDLERS["agent_internal_approvals_history"]({"status": "desconocido"})

    store._grants["s1"] = {
        "a": {"path": "C:/uno.txt", "mode": "read", "dev": 1, "ino": 2},
        "b": {"path": "C:/dos.txt", "mode": "read", "dev": 1, "ino": 3},
    }
    listed = agent_internal.HANDLERS["agent_internal_grants_list"]({"session_id": "s1"})["grants"]
    assert [grant["path"] for grant in listed] == ["C:/dos.txt", "C:/uno.txt"]
    assert all("ino" not in grant for grant in listed)
    revoked = agent_internal.HANDLERS["agent_internal_grants_revoke"]({"session_id": "s1", "path": "C:/uno.txt"})
    assert revoked == {"revoked": 1}
    assert [grant["path"] for grant in store.grants_for("s1").values()] == ["C:/dos.txt"]


def test_dispatch_dedup_never_reexecutes(store, monkeypatch):
    executed = []
    runner = agent.AgentRunner(store, lambda name: lambda params: executed.append(name) or {"ok": 1})
    monkeypatch.setattr(agent, "get_agent_runner", lambda: runner)
    monkeypatch.setattr(agent_internal._agent_chat, "readonly_methods", lambda: ["flows_list"])

    params = {"session_id": "s1", "call_id": "c1", "name": "flows_list", "params": {}}
    assert _dispatch(**params)["result"] is None
    out = _wait_result("c1")
    assert json.loads(out["result"]) == {"ok": 1}
    again = _dispatch(**params)
    assert json.loads(again["result"]) == {"ok": 1}
    assert executed == ["flows_list"]


def test_dispatch_gated_requires_bound_approved_approval(store, monkeypatch):
    executed = []
    runner = agent.AgentRunner(store, lambda name: lambda params: executed.append(name) or {"ok": 1})
    monkeypatch.setattr(agent, "get_agent_runner", lambda: runner)
    monkeypatch.setattr(agent_internal._agent_chat, "gated_methods", lambda: ["db_clear"])

    params = {"session_id": "s1", "call_id": "c1", "name": "db_clear", "params": {}}
    denied = json.loads(_dispatch(**params)["result"])
    assert denied.get("error")
    assert executed == []

    approval = agent_internal.HANDLERS["agent_internal_approval_ensure"](
        {"session_id": "s1", "call_id": "c1", "method": "db_clear", "params": {}}
    )["approval"]
    still = json.loads(_dispatch(**{**params, "approval_id": approval["id"]})["result"])
    assert still.get("error")
    agent_internal.HANDLERS["agent_internal_approval_decide"](
        {"approval_id": approval["id"], "approve": True}
    )
    assert _dispatch(**{**params, "approval_id": approval["id"]})["result"] is None
    assert json.loads(_wait_result("c1")["result"]) == {"ok": 1}
    assert executed == ["db_clear"]


def test_artifacts_expose_the_effect_receipt(store):
    store.add_artifact("s1", {"id": "art", "family": "documents", "template_id": "t",
                              "template_revision": "r", "files": []})
    outcome, record = store.dispatch_claim("s1", "c1", "document_generate", {}, None, channel="documents")
    assert outcome == "new"
    store.dispatch_note("s1", record["op_id"], {"artifact_id": "art"})
    store.dispatch_finish("s1", "c1", record["op_id"], "succeeded", "{}")
    [artifact] = store.artifacts_for("s1")
    assert artifact["receipt"] == {"channel": "documents", "approval_source": "none", "status": "succeeded"}


def test_dispatch_running_at_restart_becomes_uncertain(store, tmp_path):
    outcome, record = store.dispatch_claim("s1", "c9", "db_clear", {}, None)
    assert outcome == "new" and record["status"] == "running"
    reloaded = agent.AgentStore(tmp_path)
    record = reloaded.get_dispatch("s1", "c9")
    assert record["status"] == "uncertain"
    assert "incierto" in json.loads(record["result"])["error"]


def test_interrupted_idempotent_read_restarts_once_and_keeps_effects_uncertain(store, tmp_path, monkeypatch):
    intent = agent_internal._intent("s1", "canvas_list", {})
    _, old = store.dispatch_claim("s1", "read", "canvas_list", intent, None)
    store.dispatch_claim("s1", "write", "db_clear", {}, None)
    reloaded = agent.AgentStore(tmp_path)
    monkeypatch.setattr(agent, "get_agent_store", lambda: reloaded)
    executed = []
    runner = agent.AgentRunner(reloaded, lambda name: lambda params: executed.append(name) or {"documents": []})
    monkeypatch.setattr(agent, "get_agent_runner", lambda: runner)
    assert _dispatch(session_id="s1", call_id="read", name="canvas_list", params={})["result"] is None
    assert json.loads(_wait_result("read")["result"]) == {"documents": []}
    _dispatch(session_id="s1", call_id="read", name="canvas_list", params={})
    assert executed == ["canvas_list"]
    assert reloaded.get_dispatch("s1", "read")["op_id"] != old["op_id"]
    outcome, effect = reloaded.dispatch_claim("s1", "write", "db_clear", {}, None)
    assert outcome == "existing" and effect["status"] == "uncertain"


def test_dispatch_rejects_forged_file_grants(store, monkeypatch):
    executed = []
    runner = agent.AgentRunner(store, lambda name: lambda params: executed.append(params) or {"ok": 1})
    monkeypatch.setattr(agent, "get_agent_runner", lambda: runner)
    monkeypatch.setattr(agent_internal._agent_chat, "readonly_methods", lambda: ["flows_list"])

    _dispatch(session_id="s1", call_id="c1", name="flows_list",
              params={"_file_grants": {"write": ["C:/otra"]}})
    result = json.loads(_wait_result("c1")["result"])
    assert "permisos" in result["error"]
    assert executed == []


def test_dispatch_result_unknown_and_cancel(store):
    with pytest.raises(NotFoundError):
        _dispatch_result("inexistente")
    out = agent_internal.HANDLERS["agent_internal_dispatch_cancel"]({"session_id": "s1", "call_id": "inexistente"})
    assert out == {"cancelled": False}


def _approve(session_id, call_id, method, params, *, channel=None, source="manual"):
    request = {"session_id": session_id, "call_id": call_id, "method": method, "params": params}
    if channel:
        request["channel"] = channel
    approval = agent_internal.HANDLERS["agent_internal_approval_ensure"](request)["approval"]
    agent_internal.HANDLERS["agent_internal_approval_decide"]({"approval_id": approval["id"], "approve": True,
                                                               "source": source})
    return approval["id"]


def test_concurrent_dispatches_start_a_single_worker(store, monkeypatch):
    started = threading.Event()
    release = threading.Event()
    executed = []

    def slow(params):
        executed.append(params)
        started.set()
        release.wait(5)
        return {"ok": 1}

    monkeypatch.setattr(agent, "get_agent_runner", lambda: agent.AgentRunner(store, lambda name: slow))
    monkeypatch.setattr(agent_internal._agent_chat, "readonly_methods", lambda: ["lectura"])
    barrier = threading.Barrier(8)
    outcomes = []

    def worker():
        barrier.wait()
        outcomes.append(_dispatch(session_id="s1", call_id="c1", name="lectura", params={"a": 1}))

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(5)
    assert started.wait(5)
    release.set()
    assert json.loads(_wait_result("c1")["result"]) == {"ok": 1}
    assert len(executed) == 1
    assert len({o["dispatch"]["op_id"] for o in outcomes}) == 1


def test_dispatch_result_reports_running_output_until_it_finishes(store, monkeypatch):
    started = threading.Event()
    release = threading.Event()

    def slow(params):
        started.set()
        release.wait(5)
        return {"ok": 1}

    monkeypatch.setattr(agent, "get_agent_runner", lambda: agent.AgentRunner(store, lambda name: slow))
    monkeypatch.setattr(agent_internal._agent_chat, "readonly_methods", lambda: ["lectura"])
    op_id = _dispatch(session_id="s1", call_id="c1", name="lectura", params={})["dispatch"]["op_id"]
    assert started.wait(5)
    assert "output" not in _dispatch_result("c1")
    agent_internal._inflight[op_id].report("línea 1\n")
    agent_internal._inflight[op_id].report("línea 2\n")
    running = _dispatch_result("c1")
    assert running["result"] is None and running["output"] == "línea 1\nlínea 2\n"
    release.set()
    assert "output" not in _wait_result("c1")


def test_same_call_id_with_other_intent_is_a_conflict(store, monkeypatch):
    executed = []
    runner = agent.AgentRunner(store, lambda name: lambda params: executed.append(params) or {"ok": 1})
    monkeypatch.setattr(agent, "get_agent_runner", lambda: runner)
    monkeypatch.setattr(agent_internal._agent_chat, "readonly_methods", lambda: ["lectura"])
    _dispatch(session_id="s1", call_id="c1", name="lectura", params={"a": 1})
    _wait_result("c1")
    conflict = _dispatch(session_id="s1", call_id="c1", name="lectura", params={"a": 2})
    assert "otra intención" in json.loads(conflict["result"])["error"]
    assert executed == [{"a": 1}]


def test_repeated_call_id_in_another_conversation_is_independent(store, monkeypatch):
    executed = []
    runner = agent.AgentRunner(store, lambda name: lambda params: executed.append(params) or {"n": params["n"]})
    monkeypatch.setattr(agent, "get_agent_runner", lambda: runner)
    monkeypatch.setattr(agent_internal._agent_chat, "readonly_methods", lambda: ["lectura"])
    _dispatch(session_id="s1", call_id="call-1", name="lectura", params={"n": 1})
    _dispatch(session_id="s2", call_id="call-1", name="lectura", params={"n": 2})
    assert json.loads(_wait_result("call-1", session_id="s1")["result"]) == {"n": 1}
    assert json.loads(_wait_result("call-1", session_id="s2")["result"]) == {"n": 2}
    assert len(executed) == 2


def test_approval_from_another_conversation_or_with_other_params_is_rejected(store, monkeypatch):
    executed = []
    runner = agent.AgentRunner(store, lambda name: lambda params: executed.append(params) or {"ok": 1})
    monkeypatch.setattr(agent, "get_agent_runner", lambda: runner)
    monkeypatch.setattr(agent_internal._agent_chat, "gated_methods", lambda: ["db_export"])
    approval_id = _approve("s1", "c1", "db_export", {"format": "xlsx"})

    other_session = _dispatch(session_id="s2", call_id="c1", name="db_export",
                              params={"format": "xlsx"}, approval_id=approval_id)
    assert json.loads(other_session["result"]).get("error")
    tampered = _dispatch(session_id="s1", call_id="c1", name="db_export",
                         params={"format": "csv"}, approval_id=approval_id)
    assert "no coinciden" in json.loads(tampered["result"])["error"]
    assert executed == []
    with pytest.raises(ValidationError):
        agent_internal.HANDLERS["agent_internal_approval_ensure"](
            {"session_id": "s1", "call_id": "c1", "method": "db_export", "params": {"format": "csv"}}
        )


def test_approval_is_consumed_once_and_survives_a_crash_between_writes(store, tmp_path, monkeypatch):
    monkeypatch.setattr(agent_internal._agent_chat, "gated_methods", lambda: ["db_export"])
    approval_id = _approve("s1", "c1", "db_export", {})
    intent = agent_internal._intent("s1", "db_export", {})
    real_write = store._write_approvals
    monkeypatch.setattr(store, "_write_approvals", lambda: None)
    outcome, record = store.dispatch_claim("s1", "c1", "db_export", intent, approval_id)
    assert outcome == "new"
    monkeypatch.setattr(store, "_write_approvals", real_write)

    reloaded = agent.AgentStore(tmp_path)
    assert reloaded.get_approval(approval_id)["consumed_by"] == record["op_id"]
    assert reloaded.get_dispatch("s1", "c1")["status"] == "uncertain"
    outcome, again = reloaded.dispatch_claim("s1", "c1", "db_export", intent, approval_id)
    assert outcome == "existing" and again["op_id"] == record["op_id"]
    outcome, _ = reloaded.dispatch_claim("s1", "c2", "db_export", intent, approval_id)
    assert outcome == "rejected"


@pytest.mark.parametrize("failure", [{"error": "fallo estructurado"}, {"isError": True}, {}])
def test_large_result_keeps_full_receipt_and_summarizes_for_the_model(store, monkeypatch, failure):
    big = {"rows": ["x" * 100] * 500, **failure}
    runner = agent.AgentRunner(store, lambda name: lambda params: big)
    monkeypatch.setattr(agent, "get_agent_runner", lambda: runner)
    monkeypatch.setattr(agent_internal._agent_chat, "readonly_methods", lambda: ["lectura"])
    _dispatch(session_id="s1", call_id="c1", name="lectura", params={})
    summary = json.loads(_wait_result("c1")["result"])
    assert summary["truncated"] is True and summary["total_chars"] > 6_000
    assert summary.get("isError", False) is bool(failure)
    record = store.get_dispatch("s1", "c1")
    assert json.loads(record["result"]) == big
    assert record["status"] == ("failed" if failure else "succeeded")


def test_effects_on_the_same_resource_run_one_after_another(store, monkeypatch):
    active = []
    overlap = []
    lock = threading.Lock()

    def effect(params):
        with lock:
            active.append(params["n"])
            overlap.append(len(active))
        time.sleep(0.2)
        with lock:
            active.remove(params["n"])
        return {"n": params["n"]}

    monkeypatch.setattr(agent, "get_agent_runner", lambda: agent.AgentRunner(store, lambda name: effect))
    monkeypatch.setattr(agent_internal._agent_chat, "gated_methods", lambda: ["canvas_save"])
    first = _approve("s1", "c1", "canvas_save", {"id": "doc", "n": 1})
    second = _approve("s2", "c2", "canvas_save", {"id": "doc", "n": 2})
    _dispatch(session_id="s1", call_id="c1", name="canvas_save", params={"id": "doc", "n": 1}, approval_id=first)
    _dispatch(session_id="s2", call_id="c2", name="canvas_save", params={"id": "doc", "n": 2}, approval_id=second)
    _wait_result("c1")
    _wait_result("c2", session_id="s2")
    assert max(overlap) == 1


def test_native_tools_are_claimed_in_python_and_finished_by_electron(store):
    first = _dispatch(session_id="s1", call_id="n1", name="autoimg_status", params={}, native=True, gated=False)
    assert first["execute"] == "native" and first["result"] is None
    again = _dispatch(session_id="s1", call_id="n1", name="autoimg_status", params={}, native=True, gated=False)
    assert "execute" not in again and again["result"] is None
    finished = agent_internal.HANDLERS["agent_internal_dispatch_finish"]({
        "session_id": "s1", "call_id": "n1", "op_id": first["dispatch"]["op_id"], "result": '{"ok": true}',
    })
    assert json.loads(finished["result"]) == {"ok": True}
    assert store.get_dispatch("s1", "n1")["status"] == "succeeded"
    assert json.loads(_dispatch(session_id="s1", call_id="n1", name="autoimg_status", params={},
                                native=True, gated=False)["result"]) == {"ok": True}


def test_memory_write_is_gated_and_keeps_its_receipt(store):
    params = {"kind": "fact", "title": "Papel", "content": "El usuario usa A4"}
    blocked = _dispatch(session_id="s1", call_id="mem1", name="memory_remember", params=params)
    assert "aprobación" in json.loads(blocked["result"])["error"]
    assert store.get_dispatch("s1", "mem1") is None

    approval_id = _approve("s1", "mem1", "memory_remember", params)
    started = _dispatch(session_id="s1", call_id="mem1", name="memory_remember", params=params,
                        approval_id=approval_id)
    assert started["result"] is None
    receipt = json.loads(_wait_result("mem1")["result"])
    assert receipt["remembered"]["title"] == "Papel"
    assert store.get_dispatch("s1", "mem1")["status"] == "succeeded"


def test_task_schedule_is_a_gated_meta_dispatch_finished_by_electron(store):
    params = {"action": "create", "content": "Revisar el cierre", "due_at": "2026-10-20T09:00:00+02:00"}
    blocked = _dispatch(session_id="s1", call_id="task1", name="task_schedule", params=params,
                        meta=True, gated=True, channel="agenda")
    assert "aprobación" in json.loads(blocked["result"])["error"]
    assert store.get_dispatch("s1", "task1") is None

    approval_id = _approve("s1", "task1", "task_schedule", params, channel="agenda", source="rule")
    started = _dispatch(session_id="s1", call_id="task1", name="task_schedule", params=params,
                        meta=True, gated=True, approval_id=approval_id, channel="agenda")
    assert started["execute"] == "meta" and started["result"] is None
    record = started["dispatch"]
    assert record["channel"] == "agenda" and record["approval_source"] == "rule"
    assert agent_internal._native_leases == {}
    assert _dispatch_result("task1")["result"] is None

    finished = _finish("s1", "task1", started, result=json.dumps({"scheduled": {"id": "task-1"}}))
    assert json.loads(finished["result"]) == {"scheduled": {"id": "task-1"}}
    assert store.get_dispatch("s1", "task1")["status"] == "succeeded"
    again = _dispatch(session_id="s1", call_id="task1", name="task_schedule", params=params,
                      meta=True, gated=True, approval_id=approval_id, channel="agenda")
    assert "execute" not in again and json.loads(again["result"]) == {"scheduled": {"id": "task-1"}}
    [receipt] = agent_internal.HANDLERS["agent_internal_effects"]({"session_id": "s1"})["dispatches"]
    assert receipt["channel"] == "agenda" and receipt["approval_source"] == "rule"


def test_meta_dispatch_only_accepts_declared_meta_methods(store):
    out = _dispatch(session_id="s1", call_id="meta-x", name="fs_write", params={"path": "a.txt"}, meta=True)
    assert "no disponible" in json.loads(out["result"])["error"]
    assert store.get_dispatch("s1", "meta-x") is None


def test_native_effects_need_approval_and_unknown_native_names_are_rejected(store):
    blocked = _dispatch(session_id="s1", call_id="n1", name="autoimg_sync_to_sheet", params={}, native=True, gated=True)
    assert json.loads(blocked["result"]).get("error")
    context = {"tool_version": "test-v1", "account": "prueba@example.com", "sheet_id": "sheet-test"}
    approval = agent_internal.HANDLERS["agent_internal_approval_ensure"](
        {"session_id": "s1", "call_id": "n1", "method": "autoimg_sync_to_sheet", "params": {}, "context": context}
    )["approval"]
    agent_internal.HANDLERS["agent_internal_approval_decide"]({"approval_id": approval["id"], "approve": True})
    allowed = _dispatch(session_id="s1", call_id="n1", name="autoimg_sync_to_sheet", params={},
                        native=True, gated=True, approval_id=approval["id"], context=context)
    assert allowed["execute"] == "native"
    other = _dispatch(session_id="s1", call_id="n2", name="spotify_playback", params={}, native=True, gated=False)
    assert "no disponible" in json.loads(other["result"])["error"]


@pytest.mark.parametrize("key,value", [("account", "otra@example.com"), ("sheet_id", "otra-hoja"),
                                      ("tool_version", "test-v2"), ("scopes", [])])
def test_native_context_changes_invalidate_approval(store, key, value):
    context = {"tool_version": "test-v1", "account": "prueba@example.com", "sheet_id": "sheet-test", "scopes": ["sheets"]}
    approval = agent_internal._approval_ensure({"session_id": "s1", "call_id": "native-context",
                                               "method": "autoimg_sync_to_sheet", "params": {}, "context": context})["approval"]
    agent_internal._approval_decide({"approval_id": approval["id"], "approve": True})
    out = _dispatch(session_id="s1", call_id="native-context", name="autoimg_sync_to_sheet", params={},
                    native=True, gated=True, approval_id=approval["id"], context={**context, key: value})
    assert "no coinciden" in json.loads(out["result"])["error"]
    assert store.get_dispatch("s1", "native-context") is None


@pytest.mark.parametrize("changed", [{"page_url": "https://example.com/otra"}, {"page_time_origin": 2}])
def test_browser_approval_rejects_a_different_document(store, changed):
    context = {"tool_version": "browser-v1", "page_url": "https://example.com/informe", "page_time_origin": 1}
    params = {"ref": "1"}
    approval_id = _approve_native("s1", "browser", "web_click", params, context)
    out = _dispatch(session_id="s1", call_id="browser", name="web_click", params=params, native=True, gated=True,
                    approval_id=approval_id, context={**context, **changed})
    assert "no coinciden" in json.loads(out["result"])["error"]
    assert store.get_dispatch("s1", "browser") is None


def _approve_native(session_id, call_id, method, params, context):
    approval = agent_internal._approval_ensure({"session_id": session_id, "call_id": call_id, "method": method,
                                               "params": params, "context": context})["approval"]
    agent_internal._approval_decide({"approval_id": approval["id"], "approve": True})
    return approval["id"]


def _finish(session_id, call_id, out, result='{"ok": true}'):
    return agent_internal.HANDLERS["agent_internal_dispatch_finish"]({
        "session_id": session_id, "call_id": call_id, "op_id": out["dispatch"]["op_id"], "result": result,
    })


def test_native_effects_on_the_same_resource_wait_without_claiming(store):
    sheet = {"tool_version": "test-v1", "account_id": "u1", "sheet_id": "hoja-a"}
    other = {**sheet, "sheet_id": "hoja-b"}
    method = "autoimg_sync_to_sheet"
    first_id = _approve_native("s1", "c1", method, {}, sheet)
    second_id = _approve_native("s2", "c2", method, {}, sheet)
    third_id = _approve_native("s3", "c3", method, {}, other)
    first = _dispatch(session_id="s1", call_id="c1", name=method, params={}, native=True, gated=True,
                      approval_id=first_id, context=sheet)
    assert first["execute"] == "native"
    busy = _dispatch(session_id="s2", call_id="c2", name=method, params={}, native=True, gated=True,
                     approval_id=second_id, context=sheet)
    assert busy == {"result": None, "busy": True}
    assert store.get_dispatch("s2", "c2") is None
    assert not store.get_approval(second_id).get("consumed_by")
    independent = _dispatch(session_id="s3", call_id="c3", name=method, params={}, native=True, gated=True,
                            approval_id=third_id, context=other)
    assert independent["execute"] == "native"
    repeat = _dispatch(session_id="s1", call_id="c1", name=method, params={}, native=True, gated=True,
                       approval_id=first_id, context=sheet)
    assert "busy" not in repeat and "execute" not in repeat
    _finish("s1", "c1", first)
    second = _dispatch(session_id="s2", call_id="c2", name=method, params={}, native=True, gated=True,
                       approval_id=second_id, context=sheet)
    assert second["execute"] == "native"
    _finish("s2", "c2", second)
    _finish("s3", "c3", independent)


def test_native_wait_revalidates_the_approval_with_the_current_context(store):
    sheet = {"tool_version": "test-v1", "account_id": "u1", "sheet_id": "hoja-a"}
    method = "autoimg_sync_to_sheet"
    holder = _dispatch(session_id="s1", call_id="c1", name=method, params={}, native=True, gated=True,
                       approval_id=_approve_native("s1", "c1", method, {}, sheet), context=sheet)
    waiting_id = _approve_native("s2", "c2", method, {}, sheet)
    assert _dispatch(session_id="s2", call_id="c2", name=method, params={}, native=True, gated=True,
                     approval_id=waiting_id, context=sheet)["busy"] is True
    _finish("s1", "c1", holder)
    changed = {**sheet, "account_id": "u2"}
    out = _dispatch(session_id="s2", call_id="c2", name=method, params={}, native=True, gated=True,
                    approval_id=waiting_id, context=changed)
    assert "no coinciden" in json.loads(out["result"])["error"]
    assert store.get_dispatch("s2", "c2") is None
    retry_id = _approve_native("s3", "c3", method, {}, sheet)
    assert _dispatch(session_id="s3", call_id="c3", name=method, params={}, native=True, gated=True,
                     approval_id=retry_id, context=sheet)["execute"] == "native"


@pytest.mark.parametrize("method", ["canvas_fill_fields", "canvas_apply_layers"])
def test_python_workers_wait_for_a_native_effect_on_the_same_document(store, monkeypatch, method):
    ran = threading.Event()
    monkeypatch.setattr(agent, "get_agent_runner",
                        lambda: agent.AgentRunner(store, lambda name: lambda params: ran.set() or {"ok": True}))
    monkeypatch.setattr(agent_internal._agent_chat, "gated_methods", lambda: ["canvas_save"])
    context = {"tool_version": "test-v1"}
    params = {"id": "doc", "expected_updated_at": "1", "values": {}}
    native = _dispatch(session_id="s1", call_id="n1", name=method, params=params, native=True,
                       gated=True, approval_id=_approve_native("s1", "n1", method, params, context),
                       context=context)
    assert native["execute"] == "native"
    approval_id = _approve("s2", "c2", "canvas_save", {"id": "doc"})
    _dispatch(session_id="s2", call_id="c2", name="canvas_save", params={"id": "doc"}, approval_id=approval_id)
    assert not ran.wait(0.3)
    _finish("s1", "n1", native)
    assert ran.wait(5)
    _wait_result("c2", session_id="s2")


def test_cloud_upload_approval_is_bound_to_the_draft_content(store):
    context = {"tool_version": "test-v1", "account": "ana@example.com", "scopes": ["Files.ReadWrite"]}
    draft = store.drafts_dir("s1") / "informe.pdf"
    draft.parent.mkdir(parents=True, exist_ok=True)
    draft.write_bytes(b"%PDF-aprobado")
    params = {"draft": "informe.pdf", "replace_item_id": "item01", "expected_etag": '"e1"'}
    approval_id = _approve_native("s1", "up1", "onedrive_upload", params, context)
    draft.write_bytes(b"%PDF-modificado")
    out = _dispatch(session_id="s1", call_id="up1", name="onedrive_upload", params=params, native=True,
                    gated=True, approval_id=approval_id, context=context)
    assert "no coinciden" in json.loads(out["result"])["error"]
    with pytest.raises(ValidationError):
        _approve_native("s1", "up2", "gdrive_upload", {"draft": "falta.pdf"}, context)


def test_cloud_writes_on_the_same_remote_file_are_serialized(store):
    context = {"tool_version": "test-v1", "account": "ana@example.com", "scopes": ["spreadsheets"]}
    params = {"spreadsheet_id": "sheet0001", "range": "A1", "values": [["x"]]}
    first = _dispatch(session_id="s1", call_id="w1", name="gsheets_update_range", params=params, native=True, gated=True,
                      approval_id=_approve_native("s1", "w1", "gsheets_update_range", params, context), context=context)
    assert first["execute"] == "native"
    other = _dispatch(session_id="s2", call_id="w2", name="gsheets_append", params=params, native=True, gated=True,
                      approval_id=_approve_native("s2", "w2", "gsheets_append", params, context), context=context)
    assert other.get("busy") is True
    reads = _dispatch(session_id="s3", call_id="r1", name="gsheets_read", params=params, native=True, gated=False)
    assert reads["execute"] == "native"
    _finish("s1", "w1", first)


def test_context_lists_granted_files_and_accounts_and_removes_one_file(store, tmp_path):
    first, second = tmp_path / "a.pdf", tmp_path / "b.pdf"
    for path in (first, second):
        path.write_bytes(b"%PDF-1.4")
    agent_internal.HANDLERS["agent_internal_grants_add"]({"session_id": "s1", "paths": [str(first), str(second)]})
    context = {"tool_version": "test-v1", "account": "ana@example.com", "scopes": ["spreadsheets"]}
    _approve_native("s1", "w1", "gsheets_update_range", {"spreadsheet_id": "sheet0001", "range": "A1", "values": [["x"]]}, context)
    listed = agent_internal.HANDLERS["agent_internal_artifacts"]({"session_id": "s1"})["context"]
    assert [f["path"] for f in listed["files"]] == sorted(str(p.resolve()) for p in (first, second))
    assert listed["accounts"] == ["ana@example.com"]
    removed = agent_internal.HANDLERS["agent_internal_grant_remove"]({"session_id": "s1", "path": listed["files"][0]["path"]})
    assert removed == {"removed": 1}
    left = agent_internal.HANDLERS["agent_internal_artifacts"]({"session_id": "s1"})["context"]["files"]
    assert [f["path"] for f in left] == [listed["files"][1]["path"]]
    assert agent_internal.HANDLERS["agent_internal_artifacts"]({"session_id": "s2"})["context"] == {"files": [], "accounts": [], "workspace": None}


def test_grants_check_accepts_granted_files_and_rejects_the_rest(store, tmp_path):
    granted = tmp_path / "informe.pdf"
    granted.write_bytes(b"%PDF-1.4")
    secret = tmp_path / "secreto.txt"
    secret.write_text("clave", encoding="utf-8")
    agent_internal.HANDLERS["agent_internal_grants_add"]({"session_id": "s1", "paths": [str(granted)]})
    checked = agent_internal.HANDLERS["agent_internal_grants_check"]({"session_id": "s1", "path": str(granted)})
    assert checked["granted"] is True and checked["path"] == str(granted.resolve())
    with pytest.raises(ValidationError, match="no está autorizado"):
        agent_internal.HANDLERS["agent_internal_grants_check"]({"session_id": "s1", "path": str(secret)})
    with pytest.raises(ValidationError, match="no está autorizado"):
        agent_internal.HANDLERS["agent_internal_grants_check"]({"session_id": "s2", "path": str(granted)})


def test_grant_app_ignora_metodos_que_no_son_ui(store):
    params = {"session_id": "s1", "call_id": "c-shell", "method": "shell_run", "params": {"command": "Get-Date"}}
    first = agent_internal.HANDLERS["agent_internal_approval_ensure"](params)["approval"]
    decided = agent_internal.HANDLERS["agent_internal_approval_decide"](
        {"approval_id": first["id"], "approve": True, "grant_app": True})["approval"]
    assert decided["status"] == "approved"
    assert store.grants_for("s1") == {}


@pytest.mark.parametrize(("command", "risk"), [("Get-Date", "low"), ("Remove-Item file.txt", "high")])
def test_shell_risk_is_persisted_without_autoapproval(store, command, risk):
    approval = agent_internal.HANDLERS["agent_internal_approval_ensure"](
        {"session_id": "s1", "call_id": "risk", "method": "shell_run", "params": {"command": command}})["approval"]
    assert approval["status"] == "pending"
    persisted = agent.AgentStore(store.base_dir).get_approval(approval["id"])
    assert persisted["status"] == "pending"
    assert persisted["risk"] == risk and persisted["risk_reason"]


@pytest.mark.parametrize("method", ["shell_run", "shell_job_start"])
@pytest.mark.parametrize("cwd", [None, "subcarpeta"])
def test_shell_approval_is_bound_to_the_effective_workspace(store, tmp_path, monkeypatch, method, cwd):
    folders = [tmp_path / "primero", tmp_path / "segundo"]
    for folder in folders:
        (folder / "subcarpeta").mkdir(parents=True)
    attach = agent_internal.HANDLERS["agent_internal_grants_add"]
    attach({"session_id": "s1", "paths": [], "folders": [str(folders[0])]})
    params = {"command": "Set-Content marcador.txt 'hecho'", **({"cwd": cwd} if cwd else {})}
    approval_id = _approve("s1", "shell-workspace", method, params)
    attach({"session_id": "s1", "paths": [], "folders": [str(folders[1])]})
    executed = []
    monkeypatch.setattr(agent.get_agent_runner(), "_execute", lambda *args: executed.append(args) or '{}')

    result = _dispatch(session_id="s1", call_id="shell-workspace", name=method,
                       params=params, approval_id=approval_id)

    assert result["result"] is not None and "error" in json.loads(result["result"])
    assert not executed
    assert not any((folder / "marcador.txt").exists() for folder in folders)


@pytest.mark.parametrize("method", ["shell_run", "shell_job_start"])
def test_shell_dispatch_uses_the_approved_absolute_working_folder(store, tmp_path, monkeypatch, method):
    folder = tmp_path / "proyecto"
    (folder / "subcarpeta").mkdir(parents=True)
    agent_internal.HANDLERS["agent_internal_grants_add"](
        {"session_id": "s1", "paths": [], "folders": [str(folder)]})
    params = {"command": "Get-Location", "cwd": "subcarpeta"}
    approval_id = _approve("s1", "shell-pinned", method, params)
    executed = []
    monkeypatch.setattr(agent.get_agent_runner(), "_execute", lambda call, token: executed.append(call) or '{}')

    _dispatch(session_id="s1", call_id="shell-pinned", name=method, params=params, approval_id=approval_id)
    assert json.loads(_wait_result("shell-pinned")["result"]) == {}
    assert executed[0]["params"]["cwd"] == str(folder / "subcarpeta")
    assert executed[0]["approved_context"]["shell"]["workspace"] == str(folder)
    assert params["cwd"] == "subcarpeta"


def _cua_ensure(call_id, method="cua_click", computer=None, **extra):
    context = {"tool_version": "t1", "computer": computer if computer is not None else {"app": "Notepad.exe"}}
    return agent_internal.HANDLERS["agent_internal_approval_ensure"](
        {"session_id": "s1", "call_id": call_id, "method": method, "context": context,
         "params": {"pid": 42, "window_id": 7, "element_token": "s00000001:0"}, **extra})["approval"]


def test_cua_approval_usa_la_concesion_por_app(store):
    first = _cua_ensure("c-cua")
    assert first["status"] == "pending" and first["context"]["computer"]["app"] == "Notepad.exe"
    agent_internal.HANDLERS["agent_internal_approval_decide"](
        {"approval_id": first["id"], "approve": True, "grant_app": True})
    assert _cua_ensure("c-cua-2", "cua_type_text")["status"] == "approved"
    assert _cua_ensure("c-cua-3", computer={"app": "Calc.exe"})["status"] == "pending"


def test_cua_approval_remember_concede_la_app(store):
    first = _cua_ensure("c-cua-r1")
    agent_internal.HANDLERS["agent_internal_approval_decide"](
        {"approval_id": first["id"], "approve": True, "remember": True})
    assert _cua_ensure("c-cua-r2", "cua_hotkey")["status"] == "approved"


def test_cua_approval_desatendida_exige_una_app_identificada(store):
    assert _cua_ensure("c-cua-a1", unattended_apps=["notepad"])["status"] == "approved"
    with pytest.raises(ValidationError, match="lista blanca"):
        _cua_ensure("c-cua-a2", computer={"window": "Proceso 42 (sin leer con cua_list_windows)"},
                    unattended_apps=["notepad"])


def test_cua_nativa_exige_su_contexto_actual(store):
    with pytest.raises(ValidationError, match="contexto actual"):
        agent_internal.HANDLERS["agent_internal_approval_ensure"](
            {"session_id": "s1", "call_id": "c-cua-sin", "method": "cua_click", "params": {"pid": 42}})
