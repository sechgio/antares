import json
import threading

import pytest

from backend.core.flows import agent, agent_chat
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
    # recarga desde disco
    assert _store(tmp_path).messages(s["id"])[0]["content"] == "hola"
    assert store.delete_session(s["id"]) is True
    assert _store(tmp_path).list_sessions() == []
    assert store.messages(s["id"]) == []


def test_gated_methods_exclude_readonly_and_denied():
    gated = set(agent_chat.gated_methods())
    safe = set(ORCHESTRATABLE_METHODS)
    assert gated.isdisjoint(safe)
    assert gated <= set(backend_methods())
    for banned in ("ai_provider_save", "flows_connection_token_put", "db_clear"):
        assert banned not in gated
    # hay métodos con efectos en el catálogo que sí quedan tras la puerta
    assert len(gated) > 0


def test_tool_specs_cover_readonly_and_gated():
    specs = agent_chat.tool_specs()
    by_name = {s["name"]: s for s in specs}
    assert by_name[sorted(ORCHESTRATABLE_METHODS)[0]]["gated"] is False
    assert by_name[agent_chat.gated_methods()[0]]["gated"] is True


@pytest.mark.parametrize("style", ["openai", "anthropic"])
def test_provider_receives_native_and_mcp_argument_contracts(monkeypatch, style):
    from backend.core.flows import mcp_servers

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
    assert "document" in wire["canvas_save"]["properties"]
    assert wire["informes_v2_update"]["required"] == ["id", "report"]
    assert {"files", "destino"} <= wire["process_start"]["properties"].keys()
    assert {"formato", "calidad", "conversion_enabled", "mapping_path", "sequence_mode"} <= wire["process_start"]["properties"].keys()
    assert all(not k.startswith("_") for s in wire.values() for k in s.get("properties", {}))
    assert "flows_connection_token_refresh" not in wire


def test_tools_list_projection(monkeypatch):
    from backend.handlers import agent as agent_handler

    monkeypatch.setattr(
        agent_chat,
        "tool_specs",
        lambda: [
            {"name": "flows_list", "gated": False},
            {"name": "canvas_save", "gated": True},
            {"name": "mcp__srv1__search", "gated": True},
        ],
    )
    tools = agent_handler._tools_list({})["tools"]
    by_name = {t["name"]: t for t in tools}
    assert by_name["flows_list"] == {"name": "flows_list", "gated": False, "kind": "backend"}
    assert by_name["canvas_save"]["gated"] is True
    assert by_name["mcp__srv1__search"]["kind"] == "mcp"


def test_approval_flow(tmp_path):
    store = _store(tmp_path)
    s = store.create_session("ollama", "m", "t")
    call = {"id": "c1", "name": "flujos_x", "params": {"a": 1}}
    ap = store.create_approval(s["id"], call)
    assert store.pending_approvals(s["id"])[0]["method"] == "flujos_x"
    decided = store.decide_approval(ap["id"], True)
    assert decided["status"] == "approved" and decided["decided_at"]
    assert store.decide_approval(ap["id"], True) is None  # no doble decisión
    assert store.pending_approvals(s["id"]) == []


@pytest.mark.parametrize("name,params", [
    ("db_export", {"path": "C:/unauthorized/export.xlsx"}),
    ("flows_print_pdf", {"pdf_path": "C:/unauthorized/document.pdf"}),
    ("sellador_apply", {"pdf_path": "document.pdf"}),
    ("flows_update", {"graph": {"nodes": [{"config": {"args": {"output_path": "C:/unauthorized/out.pdf"}}}]}}),
    ("flows_update", {"graph": {"nodes": [{"config": {"_file_grants": {"write": ["C:/unauthorized"]}}}]}}),
    ("canvas_save", {"_resolved_output_path": "relative.pdf"}),
])
def test_agent_rejects_ungranted_paths_and_forged_grants_before_dispatch(tmp_path, name, params):
    calls = []
    runner = agent.AgentRunner(_store(tmp_path), lambda method: lambda args: calls.append(args) or {"ok": True})
    result = json.loads(runner._execute({"name": name, "params": params}))
    assert result.get("error")
    assert calls == []


def test_approval_does_not_grant_disk_access(tmp_path, monkeypatch):
    store, runner, executed = _fake_runner(tmp_path, monkeypatch, [{"calls": [{
        "id": "export", "name": "db_export", "params": {"path": "C:/unauthorized/export.xlsx"},
    }]}])
    session = store.create_session("ollama", "m", "Prueba")
    runner._run_loop(session["id"])
    approval = store.pending_approvals(session["id"])[0]
    monkeypatch.setattr(runner, "_spawn", lambda sid, name: runner._turn_main(sid))
    runner.decide(approval["id"], True)
    assert executed == []
    result = next(m for m in store.messages(session["id"]) if m["role"] == "tool_result")
    assert json.loads(result["content"]).get("error")


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


def _fake_runner(tmp_path, monkeypatch, replies):
    store = _store(tmp_path)
    executed = []
    monkeypatch.setattr(
        agent,
        "chat",
        lambda provider, model, messages, on_delta=None: replies.pop(0) if replies else {"text": "fin", "calls": []},
    )
    runner = agent.AgentRunner(store, lambda name: lambda params: executed.append((name, params)) or {"ok": True})
    return store, runner, executed


def test_turn_runs_safe_tool_then_answers(tmp_path, monkeypatch):
    safe_method = sorted(ORCHESTRATABLE_METHODS)[0]
    store, runner, executed = _fake_runner(
        tmp_path,
        monkeypatch,
        [
            {"text": "consulto", "calls": [{"id": "t1", "name": safe_method, "params": {}}]},
            {"text": "respuesta final", "calls": []},
        ],
    )
    s = store.create_session("ollama", "m", "t")
    runner._run_loop(s["id"])
    assert executed == [(safe_method, {})]
    roles = [m["role"] for m in store.messages(s["id"])]
    assert roles == ["assistant", "tool_result", "assistant"]
    assert store.messages(s["id"])[-1]["content"] == "respuesta final"
    assert store.pending_approvals(s["id"]) == []


def test_turn_pauses_on_gated_tool_and_decide_resumes(tmp_path, monkeypatch):
    gated = agent_chat.gated_methods()[0]
    store, runner, executed = _fake_runner(
        tmp_path,
        monkeypatch,
        [
            {"text": "", "calls": [{"id": "g1", "name": gated, "params": {"k": 1}}]},
            {"text": "hecho", "calls": []},
        ],
    )
    s = store.create_session("ollama", "m", "t")
    runner._run_loop(s["id"])
    assert executed == []  # no ejecutó nada todavía
    pending = store.pending_approvals(s["id"])
    assert len(pending) == 1 and pending[0]["method"] == gated

    # Procesa la cola sin hilo para comprobar el resultado de la decisión.
    monkeypatch.setattr(runner, "_spawn", lambda sid, name: runner._turn_main(sid))
    runner.decide(pending[0]["id"], True)
    assert executed == [(gated, {"k": 1})]
    msgs = store.messages(s["id"])
    assert msgs[-1]["content"] == "hecho"
    tool_call = next(c for m in msgs for c in (m.get("tool_calls") or []))
    assert tool_call["status"] == "done"


def test_deny_appends_denied_result_and_resumes(tmp_path, monkeypatch):
    gated = agent_chat.gated_methods()[0]
    store, runner, executed = _fake_runner(
        tmp_path,
        monkeypatch,
        [
            {"text": "", "calls": [{"id": "g1", "name": gated, "params": {}}]},
            {"text": "entendido", "calls": []},
        ],
    )
    s = store.create_session("ollama", "m", "t")
    runner._run_loop(s["id"])
    pending = store.pending_approvals(s["id"])
    monkeypatch.setattr(runner, "_spawn", lambda sid, name: runner._turn_main(sid))
    runner.decide(pending[0]["id"], False)
    assert executed == []
    msgs = store.messages(s["id"])
    result_msg = next(m for m in msgs if m["role"] == "tool_result")
    assert "rechaz" in result_msg["content"]
    assert msgs[-1]["content"] == "entendido"


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
    """Calls persistidas sin tool_result (turno interrumpido) no invalidan la request."""
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
    # ollama no exige clave pero sí alcanzable; forzamos red falsa
    seen = {}

    def fake_post(url, headers, payload, on_delta=None):
        seen["url"] = url
        return {"choices": [{"message": {"content": "ok", "tool_calls": []}}]}

    monkeypatch.setattr(agent_chat, "_post_json", fake_post)
    out = agent_chat.chat("ollama", "llama3.1", [{"role": "user", "content": "hola"}])
    assert out["text"] == "ok"
    assert seen["url"] == "http://127.0.0.1:11434/v1/chat/completions"


def test_get_agent_runner_no_deadlock(tmp_path, monkeypatch):
    """_store_lock guarda ambos singletons: get_agent_runner llama a get_agent_store
    bajo el mismo lock; con un Lock() normal se autobloquea en el primer acceso."""
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
    assert store.get_session(s["id"])["title"] == "lista mis formatos"  # no renombra


def test_approval_accepts_without_waiting_and_serializes_session_tools(tmp_path, monkeypatch):
    from backend.handlers import agent as handlers

    store = _store(tmp_path)
    session = store.create_session("ollama", "m", "Principal")
    other = store.create_session("ollama", "other", "Otra")
    method = sorted(ORCHESTRATABLE_METHODS)[0]
    calls = [{"id": f"c{i}", "name": method, "params": {"index": i}, "status": "pending"} for i in (1, 2)]
    store.append_message(session["id"], {"role": "assistant", "content": "", "tool_calls": calls})
    approvals = [store.create_approval(session["id"], call) for call in calls]
    entered, release, accepted, probed = (threading.Event() for _ in range(4))
    executed, replies, responses, states = [], {}, [], []

    def execute(params):
        executed.append(params["index"])
        if params["index"] == 1:
            entered.set()
            assert release.wait(5)
        return {"ok": True}

    def chat(provider, model, messages, on_delta=None):
        replies.setdefault(model, []).append(messages)
        return {"text": "fin", "calls": []}

    monkeypatch.setattr(agent, "chat", chat)
    runner = agent.AgentRunner(store, lambda name: execute)
    monkeypatch.setattr(handlers, "_runner", lambda: runner)

    def approve():
        responses.append(handlers._approve({"approval_id": approvals[0]["id"]}))
        accepted.set()

    def probe():
        states.append((runner.is_running(session["id"]), runner.is_running(other["id"])))
        probed.set()

    caller, reader = threading.Thread(target=approve), threading.Thread(target=probe)
    caller.start()
    try:
        assert entered.wait(3)
        assert accepted.wait(1), "agent_approve esperó a que terminara la herramienta"
        reader.start()
        assert probed.wait(1), "Las consultas de otra conversación quedaron bloqueadas"
        assert states == [(True, False)]
        assert responses[0]["approval"]["status"] == "approved"
        runner.start_turn(other["id"], "otra conversación")
        other_worker = runner._running.get(other["id"])
        if other_worker:
            other_worker.join(timeout=3)
        assert replies["other"][-1][-1]["content"] == "otra conversación"
        runner.decide(approvals[1]["id"], True)
        with pytest.raises(ValueError, match="Ya hay un turno"):
            runner.start_turn(session["id"], "duplicado")
        with pytest.raises(ValueError, match="ya decidida"):
            runner.decide(approvals[0]["id"], True)
        assert replies.get("m") is None
    finally:
        release.set()
        caller.join(timeout=3)
        if reader.ident is not None:
            reader.join(timeout=3)
        worker = runner._running.get(session["id"])
        if worker:
            worker.join(timeout=3)
    assert not runner.is_running(session["id"])
    assert executed == [1, 2]
    results = [message for message in replies["m"][0] if message["role"] == "tool_result"]
    assert [message["tool_use_id"] for message in results] == ["c1", "c2"]


def test_cancel_turn_stops_turn_and_marks_session(tmp_path, monkeypatch):
    """Un turno bloqueado en el proveedor se detiene de forma cooperativa."""
    import time

    store = _store(tmp_path)
    session = store.create_session("ollama", "m", "Lenta")
    entered = threading.Event()

    def slow_chat(provider, model, messages, on_delta=None):
        entered.set()
        time.sleep(30)
        return {"text": "nunca", "calls": []}

    monkeypatch.setattr(agent, "chat", slow_chat)
    runner = agent.AgentRunner(store, lambda name: lambda params: {})

    from backend.handlers import agent as handlers

    monkeypatch.setattr(handlers, "_runner", lambda: runner)
    monkeypatch.setattr(handlers, "_store", lambda: store)
    assert handlers._turn_cancel({"session_id": session["id"]}) == {"cancelled": False}

    runner.start_turn(session["id"], "hola")
    assert entered.wait(3)
    assert handlers._turn_cancel({"session_id": session["id"]}) == {"cancelled": True}

    deadline = time.time() + 5
    while runner.is_running(session["id"]) and time.time() < deadline:
        time.sleep(0.05)
    assert not runner.is_running(session["id"])
    messages = store.messages(session["id"])
    assert "detenido" in messages[-1]["content"]
    # El turno siguiente parte con un token nuevo: la cancelación no se hereda.
    monkeypatch.setattr(agent, "chat", lambda *a, **k: {"text": "listo", "calls": []})
    runner.start_turn(session["id"], "otra vez")
    worker = runner._running.get(session["id"])
    if worker:
        worker.join(timeout=5)
    assert not runner.is_running(session["id"])
    assert store.messages(session["id"])[-1]["content"] == "listo"


def test_interrupted_turn_gets_marked_once_on_runner_init(tmp_path):
    """Un reinicio con turno a medias deja constancia en la conversación."""
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
    # Un segundo runner no duplica el marcador.
    store3 = _store(tmp_path)
    agent.AgentRunner(store3, lambda name: lambda params: {})
    assert sum("interrumpido" in m["content"] for m in store3.messages(interrupted["id"])) == 1


def test_stale_approval_expires_and_cannot_be_decided(tmp_path):
    """Una aprobación más vieja que el TTL ya no ejecuta la acción."""
    store = _store(tmp_path)
    session = store.create_session("ollama", "m", "S")
    approval = store.create_approval(session["id"], {"id": "c1", "name": "flows_delete", "params": {}})
    store._approvals[approval["id"]]["created_at"] = agent._now_ms() - agent._APPROVAL_TTL_MS - 1
    assert store.pending_approvals(session["id"]) == []
    assert store.get_approval(approval["id"])["status"] == "expired"
    runner = agent.AgentRunner(store, lambda name: lambda params: {})
    with pytest.raises(ValueError, match="expir"):
        runner.decide(approval["id"], True)


def test_stream_response_emits_accumulated_deltas():
    """Los deltas SSE del protocolo OpenAI alimentan el texto parcial."""
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
    """Los deltas de bloques del protocolo Anthropic también llegan."""
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


def test_partial_text_checkpoint_survives_restart(tmp_path):
    store = _store(tmp_path)
    session = store.create_session("ollama", "m", "S")
    runner = agent.AgentRunner(store, lambda name: lambda params: {})
    runner._set_partial(session["id"], "escribiendo…")
    assert runner.partial_text(session["id"]) == "escribiendo…"
    runner._partial.pop(session["id"], None)
    assert runner.partial_text(session["id"]) is None
    restored = _store(tmp_path)
    agent.AgentRunner(restored, lambda name: pytest.fail("No debe ejecutar herramientas al recuperar"))
    assert "escribiendo…" in restored.messages(session["id"])[-1]["content"]
    assert "interrumpido" in restored.messages(session["id"])[-1]["content"]
    assert "_partial_text" not in restored.get_session(session["id"])


@pytest.mark.parametrize("status", ["queued", "running", "pending", "done"])
def test_recovery_never_replays_a_tool_or_a_decided_approval(tmp_path, status):
    store = _store(tmp_path)
    session = store.create_session("ollama", "m", "Tarea")
    call = {"id": "effect", "name": "flows_run", "params": {}, "status": status, "result": "resultado"}
    store.append_message(session["id"], {"role": "assistant", "content": "", "tool_calls": [call]})
    approval = store.create_approval(session["id"], call)
    store.decide_approval(approval["id"], True)
    restored = _store(tmp_path)
    runner = agent.AgentRunner(restored, lambda name: pytest.fail("No repetir efectos"))
    messages = restored.messages(session["id"])
    assert messages[0]["tool_calls"][0]["status"] == ("done" if status == "done" else "interrupted")
    assert "interrumpido" in messages[-1]["content"]
    assert not runner.is_running(session["id"])
    with pytest.raises(ValueError, match="ya decidida"):
        runner.decide(approval["id"], True)
    agent.AgentRunner(_store(tmp_path), lambda name: None)
    assert _store(tmp_path).messages(session["id"]) == messages


def test_pending_approval_recovers_and_still_requires_one_explicit_decision(tmp_path, monkeypatch):
    store = _store(tmp_path)
    session = store.create_session("ollama", "m", "Tarea")
    method = agent_chat.gated_methods()[0]
    call = {"id": "effect", "name": method, "params": {}, "status": "pending"}
    store.append_message(session["id"], {"role": "assistant", "content": "", "tool_calls": [call]})
    approval = store.create_approval(session["id"], call)
    restored = _store(tmp_path)
    executed = []
    monkeypatch.setattr(agent, "chat", lambda *a, **k: {"text": "fin", "calls": []})
    runner = agent.AgentRunner(restored, lambda name: lambda params: executed.append(name) or {"ok": True})
    assert executed == []
    assert restored.pending_approvals(session["id"])[0]["id"] == approval["id"]
    with pytest.raises(ValueError, match="aprobaciones pendientes"):
        runner.start_turn(session["id"], "otra tarea")
    monkeypatch.setattr(runner, "_spawn", lambda sid, name: runner._turn_main(sid))
    runner.decide(approval["id"], True)
    assert executed == [method]
    with pytest.raises(ValueError, match="ya decidida"):
        runner.decide(approval["id"], True)


def test_cancel_running_tool_discards_late_result_and_queued_approved_effect(tmp_path, monkeypatch):
    store = _store(tmp_path)
    session = store.create_session("ollama", "m", "Tarea")
    method = agent_chat.gated_methods()[0]
    calls = [{"id": f"c{i}", "name": method, "params": {"i": i}, "status": "pending"} for i in (1, 2)]
    store.append_message(session["id"], {"role": "assistant", "content": "", "tool_calls": calls})
    approvals = [store.create_approval(session["id"], call) for call in calls]
    entered, release, finished = (threading.Event() for _ in range(3))
    executed = []

    def execute(call, token=None):
        executed.append(call["params"]["i"])
        entered.set()
        assert release.wait(5)
        finished.set()
        return '{"ok": true}'

    monkeypatch.setattr(agent, "chat", lambda *a, **k: pytest.fail("No continuar tras cancelar"))
    runner = agent.AgentRunner(store, lambda name: None)
    monkeypatch.setattr(runner, "_execute", execute)
    runner.decide(approvals[0]["id"], True)
    try:
        assert entered.wait(3)
        assert store.messages(session["id"])[0]["tool_calls"][0]["status"] == "running"
        runner.decide(approvals[1]["id"], True)
        worker = runner._running[session["id"]]
        assert runner.cancel_turn(session["id"])
        worker.join(3)
        assert not runner.is_running(session["id"])
        assert executed == [1]
        assert [c["status"] for c in store.messages(session["id"])[0]["tool_calls"]] == ["interrupted"] * 2
        release.set()
        assert finished.wait(3)
        assert store.messages(session["id"])[0]["tool_calls"][0]["status"] == "interrupted"
    finally:
        release.set()


def test_cancel_turn_waiting_for_approval_does_not_execute(tmp_path):
    store = _store(tmp_path)
    session = store.create_session("ollama", "m", "Tarea")
    call = {"id": "c1", "name": "flows_run", "params": {}, "status": "pending"}
    store.append_message(session["id"], {"role": "assistant", "content": "", "tool_calls": [call]})
    approval = store.create_approval(session["id"], call)
    runner = agent.AgentRunner(store, lambda name: pytest.fail("No ejecutar al cancelar"))
    assert runner.cancel_turn(session["id"])
    worker = runner._running.get(session["id"])
    if worker:
        worker.join(3)
    assert not runner.is_running(session["id"])
    assert store.pending_approvals(session["id"]) == []
    with pytest.raises(ValueError, match="ya decidida"):
        runner.decide(approval["id"], True)


def test_cancelled_provider_cannot_publish_deltas_to_a_new_turn(tmp_path):
    store = _store(tmp_path)
    session = store.create_session("ollama", "m", "Tarea")
    runner = agent.AgentRunner(store, lambda name: None)
    old = agent._CancelEvent()
    old.cancel()
    runner._cancel[session["id"]] = agent._CancelEvent()
    runner._set_partial(session["id"], "tardío", old)
    assert runner.partial_text(session["id"]) is None
    assert "_partial_text" not in store.get_session(session["id"])


@pytest.mark.parametrize("result", ['{"error": "falló"}', '{"isError": true}', '{"ok": true}'])
def test_tool_failures_have_distinct_status(tmp_path, monkeypatch, result):
    store = _store(tmp_path)
    session = store.create_session("ollama", "m", "Tarea")
    call = {"id": "c1", "name": "flows_run", "params": {}, "status": "queued"}
    store.append_message(session["id"], {"role": "assistant", "content": "", "tool_calls": [call]})
    runner = agent.AgentRunner(store, lambda name: None)
    monkeypatch.setattr(runner, "_execute", lambda call, token=None: result)
    assert runner._execute_call(session["id"], call) == result
    assert store.messages(session["id"])[0]["tool_calls"][0]["status"] == ("done" if "ok" in result else "failed")


def test_first_messages_snapshot_includes_restart_recovery(tmp_path, monkeypatch):
    from backend.handlers import agent as handlers

    store = _store(tmp_path)
    session = store.create_session("ollama", "m", "Tarea")
    store.append_message(session["id"], {"role": "user", "content": "pendiente"})
    restored = _store(tmp_path)
    monkeypatch.setattr(handlers, "_store", lambda: restored)
    monkeypatch.setattr(agent, "_store_singleton", restored)
    monkeypatch.setattr(agent, "_runner_singleton", None)
    snapshot = handlers._messages_list({"session_id": session["id"]})
    assert "interrumpido" in snapshot["messages"][-1]["content"]
    assert not snapshot["running"]


def test_recovery_does_not_duplicate_a_response_written_before_checkpoint_cleanup(tmp_path):
    store = _store(tmp_path)
    session = store.create_session("ollama", "m", "Tarea")
    store.append_message(session["id"], {"role": "assistant", "content": "Progreso completado"})
    store.save_partial(session["id"], "Progreso")
    restored = _store(tmp_path)
    agent.AgentRunner(restored, lambda name: None)
    assert restored.messages(session["id"]) == store.messages(session["id"])
    assert "_partial_text" not in restored.get_session(session["id"])


def test_cancel_removes_a_tool_still_queued_in_the_scheduler(tmp_path, monkeypatch):
    from concurrent.futures import Future
    from unittest.mock import Mock

    store = _store(tmp_path)
    session = store.create_session("ollama", "m", "Tarea")
    method = sorted(ORCHESTRATABLE_METHODS)[0]
    call = {"id": "queued", "name": method, "params": {}, "status": "pending"}
    store.append_message(session["id"], {"role": "assistant", "content": "", "tool_calls": [call]})
    approval = store.create_approval(session["id"], call)
    future = Future()
    submitted, cancelled = threading.Event(), threading.Event()
    future.add_done_callback(lambda result: cancelled.set())

    def submit(fn, params):
        submitted.set()
        return future

    monkeypatch.setattr(agent, "lane_for", lambda name: "light")
    monkeypatch.setattr(agent, "get_scheduler", lambda: Mock(submit_light=submit))
    runner = agent.AgentRunner(store, lambda name: lambda params: pytest.fail("No ejecutar trabajo en cola"))
    runner.decide(approval["id"], True)
    assert submitted.wait(3)
    worker = runner._running[session["id"]]
    assert runner.cancel_turn(session["id"])
    worker.join(3)
    assert cancelled.wait(3)
    assert future.cancelled()
    assert store.messages(session["id"])[0]["tool_calls"][0]["status"] == "interrupted"
