import json
import threading

import pytest

from backend.core.agent import agent, agent_chat
from backend.core.ipc_catalog import ORCHESTRATABLE_METHODS, backend_methods


def _store(tmp_path):
    return agent.AgentStore(tmp_path)


def test_session_lifecycle(tmp_path):
    store = _store(tmp_path)
    s = store.create_session("ollama", "llama3.1", "Prueba")
    assert store.get_session(s["id"])["model"] == "llama3.1"
    assert [x["id"] for x in store.list_sessions()] == [s["id"]]
    store.append_message(s["id"], {"role": "user", "content": "hola"})
    msgs = store.messages(s["id"])
    assert msgs[0]["content"] == "hola" and msgs[0]["ts"] > 0
    assert _store(tmp_path).messages(s["id"])[0]["content"] == "hola"
    assert store.delete_session(s["id"]) is True
    assert _store(tmp_path).list_sessions() == []
    assert store.messages(s["id"]) == []


def test_gated_methods_exclude_readonly_and_denied():
    gated = set(agent_chat.gated_methods())
    safe = set(ORCHESTRATABLE_METHODS)
    assert gated.isdisjoint(safe)
    from backend.core.agent import agent_tools

    assert gated <= set(backend_methods()) | set(agent_tools.SPECS)
    for banned in ("ai_provider_save", "connections_token_put", "db_clear", "editor_project_save"):
        assert banned not in gated
    assert len(gated) > 0


def test_tool_specs_cover_readonly_and_gated():
    specs = agent_chat.tool_specs()
    by_name = {s["name"]: s for s in specs}
    assert by_name[sorted(ORCHESTRATABLE_METHODS)[0]]["gated"] is False
    assert by_name[agent_chat.gated_methods()[0]]["gated"] is True


def test_memory_writes_are_gated_effects():
    from backend.core.agent import agent_tools

    gated = set(agent_chat.gated_methods())
    for name in ("memory_remember", "procedure_learn"):
        assert agent_tools.SPECS[name]["gated"] is True
        assert name in agent_tools.EFFECT_TOOLS
        assert name in gated
    assert "memory_search" in agent_tools.READ_TOOLS
    assert "memory_search" not in gated


def test_task_schedule_is_a_gated_meta_tool_with_the_electron_schema():
    from backend.core.agent import agent_tools

    spec = agent_tools.SPECS["task_schedule"]
    assert spec["gated"] is True and spec["module"] == "agenda"
    assert spec["inputSchema"] == {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["create", "list", "cancel", "enqueue", "pause", "resume"]},
            "content": {"type": "string", "minLength": 1, "maxLength": 12000},
            "due_at": {"type": "string"},
            "every_minutes": {"type": "integer", "minimum": 1, "maximum": 525600},
            "id": {"type": "string"},
        },
        "required": ["action"],
    }
    assert "task_schedule" in agent_chat.gated_methods()


def test_task_schedule_has_no_backend_execution(tmp_path):
    from backend.core.agent import agent_tools

    store = _store(tmp_path)
    with pytest.raises(ValueError, match="no disponible"):
        agent_tools.run("task_schedule", {"action": "list"}, store, "s1")


@pytest.mark.parametrize("style", ["openai", "anthropic"])
def test_provider_receives_native_and_mcp_argument_contracts(monkeypatch, style):
    from backend.core.integrations import mcp_servers

    schema = {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}
    monkeypatch.setattr(mcp_servers, "list_servers", lambda: [{"id": "demo", "name": "Demo"}])
    monkeypatch.setattr(mcp_servers, "list_tools", lambda server: [{
        "name": "search", "description": "Busca", "inputSchema": schema,
    }])
    seen = {}
    response = {"choices": [{"message": {"content": "ok"}}]} if style == "openai" else {"content": []}
    monkeypatch.setattr(agent_chat, "_post_json", lambda url, headers, payload, on_delta=None: seen.update(payload) or response)
    chat = agent_chat._chat_openai if style == "openai" else agent_chat._chat_anthropic
    chat("https://example.com", {}, "model", [], True, None)
    wire = {s["function"]["name"]: s["function"]["parameters"] for s in seen["tools"]} if style == "openai" else {
        s["name"]: s["input_schema"] for s in seen["tools"]}
    assert wire[mcp_servers.agent_tool_name("demo", "search")] == schema
    assert wire["canvas_get"]["required"] == ["id"]
    assert "canvas_save" not in wire and wire["canvas_fill_fields"]["required"] == ["id", "expected_updated_at", "values"]
    assert wire["informes_v2_update"]["required"] == ["id", "report"]
    assert {"files", "destino"} <= wire["process_start"]["properties"].keys()
    assert {"formato", "calidad", "conversion_enabled", "mapping_path", "sequence_mode"} <= wire["process_start"]["properties"].keys()
    assert all(not k.startswith("_") for s in wire.values() for k in s.get("properties", {}))
    assert "connections_token_refresh" not in wire


def test_approval_flow(tmp_path):
    store = _store(tmp_path)
    s = store.create_session("ollama", "m", "t")
    call = {"id": "c1", "name": "flujos_x", "params": {"a": 1}}
    ap = store.create_approval(s["id"], call)
    assert store.pending_approvals(s["id"])[0]["method"] == "flujos_x"
    decided = store.decide_approval(ap["id"], True)
    assert decided["status"] == "approved" and decided["decided_at"]
    assert store.decide_approval(ap["id"], True) is None
    assert store.pending_approvals(s["id"]) == []


def test_approval_history_filters_and_joins_dispatch(tmp_path):
    store = _store(tmp_path)
    s1 = store.create_session("ollama", "m", "uno")["id"]
    s2 = store.create_session("ollama", "m", "dos")["id"]
    first = store.create_approval(s1, {"id": "c1", "name": "flujos_x", "params": {"a": 1}})
    second = store.create_approval(s1, {"id": "c2", "name": "db_export", "params": {}})
    third = store.create_approval(s2, {"id": "c3", "name": "flujos_x", "params": {}})
    store.decide_approval(first["id"], True)
    store.decide_approval(second["id"], False)
    status, record = store.dispatch_claim(s1, "c1", "flujos_x", {"a": 1}, first["id"])
    assert status == "new"
    store.dispatch_finish(s1, "c1", record["op_id"], "uncertain", "{}")

    assert {a["id"] for a in store.approval_history()} == {first["id"], second["id"], third["id"]}
    assert {a["id"] for a in store.approval_history(session_id=s1)} == {first["id"], second["id"]}
    assert {a["id"] for a in store.approval_history(method="db_export")} == {second["id"]}
    assert {a["id"] for a in store.approval_history(status="approved")} == {first["id"]}
    assert {a["id"] for a in store.approval_history(status="denied")} == {second["id"]}
    assert {a["id"] for a in store.approval_history(status="uncertain")} == {first["id"]}
    assert len(store.approval_history(limit=1)) == 1
    joined = next(a for a in store.approval_history() if a["id"] == first["id"])
    assert joined["dispatch"]["status"] == "uncertain"


def test_approval_history_keeps_expired_decisions(tmp_path, monkeypatch):
    store = _store(tmp_path)
    session_id = store.create_session("ollama", "m", "t")["id"]
    approval = store.create_approval(session_id, {"id": "c1", "name": "flujos_x", "params": {}})
    monkeypatch.setattr(agent, "_APPROVAL_TTL_MS", -1)
    assert store.pending_approvals(session_id) == []
    assert [a["id"] for a in store.approval_history(status="expired")] == [approval["id"]]


@pytest.mark.parametrize("name,params", [
    ("db_export", {"path": "C:/unauthorized/export.xlsx"}),
    ("print_pdf", {"pdf_path": "C:/unauthorized/document.pdf"}),
    ("sellador_apply", {"pdf_path": "document.pdf"}),
    ("canvas_save", {"document": {"layers": [{"meta": {"output_path": "C:/unauthorized/out.pdf"}}]}}),
    ("canvas_save", {"document": {"layers": [{"meta": {"_file_grants": {"write": ["C:/unauthorized"]}}}]}}),
    ("canvas_save", {"_resolved_output_path": "relative.pdf"}),
])
def test_agent_rejects_ungranted_paths_and_forged_grants_before_dispatch(tmp_path, name, params):
    calls = []
    runner = agent.AgentRunner(_store(tmp_path), lambda method: lambda args: calls.append(args) or {"ok": True})
    result = json.loads(runner._execute({"name": name, "params": params}))
    assert result.get("error")
    assert calls == []


@pytest.mark.parametrize("method,lane", [("formats", "light"), ("canvas_export_cmyk_pdf", "heavy")])
def test_agent_dispatch_uses_catalog_lane_and_timeout(tmp_path, monkeypatch, method, lane):
    from concurrent.futures import Future
    from unittest.mock import Mock

    scheduler = Mock()
    submitted = []
    futures = []

    def submit(fn, params):
        submitted.append(params)
        future = Future()
        future.set_result(fn(params))
        wrapped = Mock(wraps=future)
        futures.append(wrapped)
        return wrapped

    getattr(scheduler, f"submit_{lane}").side_effect = submit
    monkeypatch.setattr(agent, "get_scheduler", lambda: scheduler)
    runner = agent.AgentRunner(_store(tmp_path), lambda method: lambda params: {"ok": True})
    assert json.loads(runner._execute({"name": method, "params": {}})) == {"ok": True}
    assert submitted == [{}]
    submit_mock = getattr(scheduler, f"submit_{lane}")
    submit_mock.assert_called_once()
    futures[0].result.assert_called_once_with(timeout=agent.timeout_ms_for(method) / 1000)


def test_agent_reports_timeout_without_retrying_the_action(tmp_path, monkeypatch):
    from unittest.mock import Mock

    future = Mock()
    future.result.side_effect = agent.FutureTimeoutError
    scheduler = Mock()
    scheduler.submit_light.return_value = future
    monkeypatch.setattr(agent, "get_scheduler", lambda: scheduler)
    runner = agent.AgentRunner(_store(tmp_path), lambda method: lambda params: {"ok": True})
    result = json.loads(runner._execute({"name": "formats", "params": {}}))
    assert "puede seguir ejecutándose" in result["error"]
    scheduler.submit_light.assert_called_once()
    future.cancel.assert_called_once()


def test_update_tool_call(tmp_path):
    store = _store(tmp_path)
    s = store.create_session("ollama", "m", "t")
    store.append_message(
        s["id"], {"role": "assistant", "content": "", "tool_calls": [{"id": "c9", "name": "x", "status": "queued"}]}
    )
    store.update_tool_call(s["id"], "c9", "done", "resultado")
    call = store.messages(s["id"])[0]["tool_calls"][0]
    assert call["status"] == "done" and call["result"] == "resultado"


def test_openai_wire_and_parse():
    msgs = [
        {"role": "user", "content": "hola"},
        {
            "role": "assistant",
            "content": "un momento",
            "tool_calls": [{"id": "c1", "name": "m1", "params": {"a": 2}}],
        },
        {"role": "tool_result", "tool_use_id": "c1", "content": "{}"},
    ]
    wire = agent_chat._openai_wire(msgs, None)
    assert wire[0]["role"] == "system"
    assert wire[1] == {"role": "user", "content": "hola"}
    assert wire[2]["tool_calls"][0]["function"]["name"] == "m1"
    assert json.loads(wire[2]["tool_calls"][0]["function"]["arguments"]) == {"a": 2}
    assert wire[3] == {"role": "tool", "tool_call_id": "c1", "content": "{}"}


def test_anthropic_wire_groups_tool_results():
    msgs = [
        {"role": "user", "content": "hola"},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "c1", "name": "m1", "params": {}}]},
        {"role": "tool_result", "tool_use_id": "c1", "content": "{}"},
        {"role": "assistant", "content": "listo"},
    ]
    wire = agent_chat._anthropic_wire(msgs)
    assert wire[0] == {"role": "user", "content": "hola"}
    assert wire[1]["role"] == "assistant" and wire[1]["content"][0]["type"] == "tool_use"
    assert wire[2]["role"] == "user" and wire[2]["content"][0]["type"] == "tool_result"
    assert wire[3] == {"role": "assistant", "content": [{"type": "text", "text": "listo"}]}


def test_wire_synthesizes_missing_tool_results():
    msgs = [
        {"role": "user", "content": "hola"},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "c1", "name": "m1", "params": {}}]},
        {"role": "assistant", "content": "⚠ Error del agente: x"},
        {"role": "user", "content": "siguiente"},
    ]
    wire = agent_chat._openai_wire(msgs, None)
    assert [m.get("role") for m in wire] == ["system", "user", "assistant", "tool", "assistant", "user"]
    assert wire[3]["tool_call_id"] == "c1" and "interrumpido" in wire[3]["content"]
    awire = agent_chat._anthropic_wire(msgs)
    user_results = [
        block
        for m in awire
        if m["role"] == "user" and isinstance(m["content"], list)
        for block in m["content"]
    ]
    assert any(b.get("type") == "tool_result" and b.get("tool_use_id") == "c1" for b in user_results)


def test_chat_requires_configured_provider(tmp_path, monkeypatch):
    monkeypatch.setattr(agent_chat.ai_providers, "user_data_path", lambda rel: tmp_path / rel)
    with pytest.raises(ValueError, match="API key"):
        agent_chat.chat("openai", "gpt-4o-mini", [])
    seen = {}

    def fake_post(url, headers, payload, on_delta=None):
        seen["url"] = url
        return {"choices": [{"message": {"content": "ok", "tool_calls": []}}]}

    monkeypatch.setattr(agent_chat, "_post_json", fake_post)
    out = agent_chat.chat("ollama", "llama3.1", [{"role": "user", "content": "hola"}])
    assert out["text"] == "ok"
    assert seen["url"] == "http://127.0.0.1:11434/v1/chat/completions"


def test_get_agent_runner_no_deadlock(tmp_path, monkeypatch):
    monkeypatch.setattr(agent, "user_data_path", lambda rel: tmp_path / rel)
    monkeypatch.setattr(agent, "_store_singleton", None)
    monkeypatch.setattr(agent, "_runner_singleton", None)
    done = []
    thread = threading.Thread(target=lambda: done.append(agent.get_agent_runner()), daemon=True)
    thread.start()
    thread.join(timeout=5)
    assert done, "get_agent_runner quedó bloqueado por _store_lock"


def test_first_user_message_titles_session(tmp_path):
    store = _store(tmp_path)
    s = store.create_session("ollama", "m", "")
    assert s["title"] == "Conversación"
    store.append_message(s["id"], {"role": "user", "content": "  lista mis formatos  "})
    assert store.get_session(s["id"])["title"] == "lista mis formatos"
    store.append_message(s["id"], {"role": "user", "content": "otro"})
    assert store.get_session(s["id"])["title"] == "lista mis formatos"


def test_interrupted_turn_gets_marked_once_on_runner_init(tmp_path):
    store = _store(tmp_path)
    interrupted = store.create_session("ollama", "m", "A medias")
    store.append_message(interrupted["id"], {"role": "user", "content": "sin respuesta"})
    ok = store.create_session("ollama", "m", "Cerrada")
    store.append_message(ok["id"], {"role": "user", "content": "hola"})
    store.append_message(ok["id"], {"role": "assistant", "content": "respuesta"})
    waiting = store.create_session("ollama", "m", "Con aprobación")
    store.append_message(waiting["id"], {"role": "user", "content": "haz algo"})
    store.create_approval(waiting["id"], {"id": "c1", "name": "flows_delete", "params": {}})

    store2 = _store(tmp_path)
    agent.AgentRunner(store2, lambda name: lambda params: {})

    assert "interrumpido" in store2.messages(interrupted["id"])[-1]["content"]
    assert store2.messages(ok["id"])[-1]["content"] == "respuesta"
    assert store2.messages(waiting["id"])[-1]["content"] == "haz algo"
    store3 = _store(tmp_path)
    agent.AgentRunner(store3, lambda name: lambda params: {})
    assert sum("interrumpido" in m["content"] for m in store3.messages(interrupted["id"])) == 1


def test_stream_response_emits_accumulated_deltas():
    import io

    sse = (
        b'data: {"choices":[{"index":0,"delta":{"content":"Ho"}}]}\n\n'
        b'data: {"choices":[{"index":0,"delta":{"content":"la"}}]}\n\n'
        b'data: [DONE]\n\n'
    )
    seen: list[str] = []
    res = agent_chat._stream_response(io.BytesIO(sse), on_delta=seen.append)
    assert seen == ["Ho", "Hola"]
    assert res["choices"][0]["message"]["content"] == "Hola"


def test_stream_response_emits_deltas_for_native_protocol():
    import io

    sse = (
        b'data: {"type":"message_start"}\n\n'
        b'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n'
        b'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Ho"}}\n\n'
        b'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"la"}}\n\n'
        b'data: {"type":"content_block_stop","index":0}\n\n'
        b'data: {"type":"message_stop"}\n\n'
    )
    seen: list[str] = []
    res = agent_chat._stream_response(io.BytesIO(sse), on_delta=seen.append)
    assert seen == ["Ho", "Hola"]
    assert res["content"][0]["text"] == "Hola"


def test_recovery_does_not_duplicate_a_response_written_before_checkpoint_cleanup(tmp_path):
    store = _store(tmp_path)
    session = store.create_session("ollama", "m", "Tarea")
    store.append_message(session["id"], {"role": "assistant", "content": "Progreso completado"})
    store.save_partial(session["id"], "Progreso")
    restored = _store(tmp_path)
    agent.AgentRunner(restored, lambda name: None)
    assert restored.messages(session["id"]) == store.messages(session["id"])
    assert "_partial_text" not in restored.get_session(session["id"])


def test_tool_results_scrub_secrets():
    scrubbed = agent_chat.scrub_secrets({"config": {
        "secret": "s3cr3t",
        "headers": {"Authorization": "Bearer x"},
        "_file_grants": {"signature": "abc", "read": ["C:\tmp"]},
        "name": "visible",
    }})
    assert scrubbed["config"] == {"secret": "…", "headers": "…", "_file_grants": "…", "name": "visible"}
