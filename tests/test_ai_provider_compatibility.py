import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from backend.core.flows import agent, agent_chat, ai_providers, vault
from backend.core.flows.runner import FlowRunner
from backend.handlers import agent as agent_handlers
from backend.handlers import flows as flow_handlers


@pytest.fixture
def provider_server(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_providers, "user_data_path", lambda rel: tmp_path / rel)
    monkeypatch.setattr(vault, "user_data_path", lambda rel: tmp_path / rel)
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append((self.path, dict(self.headers), None))
            if self.path.startswith("/bad-json/"):
                self.reply_bytes(b"not JSON", "application/json")
            elif self.path.startswith("/oversized/"):
                self.reply({"data": [], "padding": "x" * 200})
            elif self.path.startswith("/no-models/"):
                self.reply({"error": "not found"}, 404)
            elif self.path.startswith("/invalid/"):
                self.reply({"error": "unsupported"})
            else:
                self.reply({"data": [{"id": "custom-model"}]})

        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append((self.path, dict(self.headers), payload))
            if payload["model"] == "retry" and len(requests) < 3:
                self.reply({"error": {"message": "Límite temporal"}}, 429)
            elif payload["model"].startswith("stream"):
                assert payload.get("stream") is True
                native = self.path.endswith("/messages")
                if native:
                    events = [
                        {"type": "message_start", "message": {"id": "msg-1", "type": "message", "role": "assistant", "content": [], "model": "stream", "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 1, "output_tokens": 0}}},
                        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
                        {"type": "ping"},
                        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Sí"}},
                        {"type": "content_block_stop", "index": 0},
                        {"type": "content_block_start", "index": 1, "content_block": {
                            "type": "tool_use", "id": "call-1", "name": "formats", "input": {},
                        }},
                        {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": '{"n":'}},
                        {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": '2}'}},
                        {"type": "content_block_stop", "index": 1},
                        {"type": "message_delta", "delta": {"stop_reason": "tool_use", "stop_sequence": None}, "usage": {"output_tokens": 4}},
                        {"type": "message_stop"},
                    ]
                else:
                    events = [
                        {"choices": [{"index": 0, "delta": {"role": "assistant", "content": "Sí"}}]},
                        {"choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "id": "call-1", "type": "function", "function": {"name": "formats", "arguments": '{"n":'}}]}}]},
                        {"choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "function": {"arguments": '2}'}}]}}]},
                        {"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]},
                        {"choices": [], "usage": {"completion_tokens": 4}},
                        "[DONE]",
                    ]
                if payload["model"] == "stream-text":
                    events = [events[i] for i in (0, 1, 2, 3, 4, 9, 10)] if native else [events[i] for i in (0, 3, 4, 5)]
                elif payload["model"] == "stream-bad-arguments":
                    events = [json.loads(json.dumps(e).replace('2}', 'oops}')) if isinstance(e, dict) else e for e in events]
                elif payload["model"] == "stream-incomplete":
                    events = events[:4]
                elif payload["model"] == "stream-error":
                    events = [*events[:4], {"type": "error", "error": {"message": "Invalid test-key-1234"}}]
                if not native:
                    events = [
                        {"id": "chat-1", "object": "chat.completion.chunk", "created": 1, "model": "stream", **e}
                        if isinstance(e, dict) else e for e in events
                    ]
                wire = b": keepalive\r\n\r\n" + b"".join(
                    ((f"event: {e['type']}\r\n" if native else "") + "data: " + (e if isinstance(e, str) else json.dumps(e, ensure_ascii=False)) + "\r\n\r\n").encode()
                    for e in events
                )
                self.reply_bytes(wire, "text/event-stream")
            elif payload["model"] == "bad-json":
                self.reply_bytes(b"not JSON", "application/json")
            elif payload["model"] == "invalid-tools":
                self.reply({"content": [None]} if self.path.endswith("/messages") else {"choices": [{"message": {"tool_calls": [None]}}]})
            elif payload["model"] == "invalid-text":
                self.reply({"content": [{"type": "text", "text": {}}]} if self.path.endswith("/messages") else {"choices": [{"message": {"content": {}}}]})
            elif payload["model"] == "invalid":
                self.reply({"error": "unsupported"})
            elif payload["model"] == "echo-key":
                self.reply({"error": {"message": self.headers.get("Authorization") or self.headers.get("x-api-key")}}, 401)
            elif self.path.endswith("/messages"):
                self.reply({"content": [{"type": "text", "text": "Listo"}, {
                    "type": "tool_use", "id": "call-1", "name": "formats", "input": {},
                }]})
            else:
                self.reply({"choices": [{"message": {"content": "Listo", "tool_calls": [{
                    "id": "call-1", "type": "function",
                    "function": {"name": "formats", "arguments": "{}"},
                }]}}]})

        def reply(self, data, status=200):
            self.reply_bytes(json.dumps(data).encode(), "application/json", status)

        def reply_bytes(self, data, content_type, status=200):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            if status == 429:
                self.send_header("Retry-After", "-1")
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


@pytest.mark.parametrize(("provider", "suffix", "models_path", "chat_path"), [
    ("openai", "/gateway/v1/", "/gateway/v1/models", "/gateway/v1/chat/completions"),
    ("openai", "/gateway", "/gateway/models", "/gateway/chat/completions"),
    ("anthropic", "/gateway", "/gateway/v1/models", "/gateway/v1/messages"),
    ("anthropic", "/gateway/v1/", "/gateway/v1/models", "/gateway/v1/messages"),
])
def test_custom_provider_roundtrip_and_protocol(provider_server, monkeypatch, provider, suffix, models_path, chat_path):
    base, requests = provider_server
    result = flow_handlers._ai_provider_save({
        "provider": provider, "api_key": "test-key-1234", "base_url": base + suffix, "model": "custom-model",
    })
    assert "test-key-1234" not in json.dumps(result)
    listed = next(p for p in flow_handlers._ai_providers_list({})["providers"] if p["id"] == provider)
    assert listed["default_model"] == "custom-model"
    assert listed["base_url"] == base + suffix.rstrip("/")
    monkeypatch.setattr(agent_chat, "tool_specs", lambda: [{
        "name": "formats", "description": "Formatos", "inputSchema": {"type": "object", "properties": {}},
    }])
    assert ai_providers.status(provider)["models_count"] == 1
    response = agent_chat.chat(provider, listed["default_model"], [{"role": "user", "content": "Hola"}])
    assert response == {"text": "Listo", "calls": [{"id": "call-1", "name": "formats", "params": {}}]}
    assert [r[0] for r in requests] == [models_path, chat_path]
    headers = {key.lower(): value for key, value in requests[-1][1].items()}
    payload = requests[-1][2]
    assert payload["model"] == "custom-model"
    if provider == "openai":
        assert headers["authorization"] == "Bearer test-key-1234"
        assert "x-api-key" not in headers
        assert payload["tools"][0]["function"]["parameters"]["properties"] == {}
        assert payload["messages"][0]["role"] == "system"
    else:
        assert headers["x-api-key"] == "test-key-1234"
        assert headers["anthropic-version"] == "2023-06-01"
        assert "authorization" not in headers
        assert payload["tools"][0]["input_schema"]["properties"] == {}
        assert payload["max_tokens"] > 0 and payload["system"]
    agent_chat.chat(provider, "custom-model", [
        {"role": "user", "content": "Hola"},
        {"role": "assistant", "content": "", "tool_calls": response["calls"]},
        {"role": "tool_result", "tool_use_id": "call-1", "content": '{"formats": ["PDF"]}'},
    ], with_tools=False)
    followup = requests[-1][2]
    assert "tools" not in followup
    if provider == "openai":
        assert followup["messages"][-1]["tool_call_id"] == "call-1"
    else:
        assert followup["messages"][-1]["content"][0]["tool_use_id"] == "call-1"


def test_saved_model_used_by_sessions_and_flow_nodes(provider_server, tmp_path, monkeypatch):
    base, requests = provider_server
    ai_providers.put_config("anthropic", {"api_key": "test-key", "base_url": base + "/v1", "model": "custom-model"})
    store = agent.AgentStore(tmp_path / "agent")
    monkeypatch.setattr(agent_handlers, "_store", lambda: store)
    session = agent_handlers._session_create({"provider": "anthropic"})["session"]
    assert session["model"] == "custom-model"
    assert agent_handlers._session_create({"provider": "anthropic", "model": "explicit"})["session"]["model"] == "explicit"
    result = FlowRunner._run_agent({"config": {"provider": "anthropic", "prompt": "Hola"}}, {})
    assert result["json"]["model"] == "custom-model"
    assert result["json"]["text"] == "Listo"
    assert requests[-1][0] == "/v1/messages"
    assert "tools" not in requests[-1][2]


def test_model_and_url_can_be_reset_without_replacing_key(provider_server):
    base, _ = provider_server
    ai_providers.put_config("openai", {"api_key": "test-key", "base_url": base, "model": " custom-model "})
    ai_providers.put_config("openai", {"api_key": "new-key"})
    assert ai_providers.public_state("openai")["default_model"] == "custom-model"
    assert ai_providers.public_state("openai")["base_url"] == base
    ai_providers.put_config("openai", {"model": "", "base_url": ""})
    assert ai_providers.get_config("openai") == {"api_key": "new-key"}
    assert ai_providers.public_state("openai")["default_model"] == "gpt-4o-mini"


@pytest.mark.parametrize("url", ["https://", "https:///v1", "https://host:bad/v1", "https://user:secret@host/v1", "https://host/v1?key=secret", "https://host/v1#fragment"])
def test_invalid_base_url_rejected_before_saving(provider_server, url):
    with pytest.raises(ValueError, match="URL"):
        ai_providers.put_config("openai", {"api_key": "test-key", "base_url": url})
    assert ai_providers.get_config("openai") is None


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
def test_models_endpoint_optional_and_invalid_responses_not_success(provider_server, provider):
    base, _ = provider_server
    ai_providers.put_config(provider, {"api_key": "test-key", "base_url": base + "/no-models"})
    status = ai_providers.status(provider)
    assert status["reachable"] is False
    assert "listado de modelos" in status["error"]
    assert agent_chat.chat(provider, "custom-model", [{"role": "user", "content": "Hola"}], with_tools=False)["text"] == "Listo"
    ai_providers.put_config(provider, {"base_url": base + "/invalid"})
    assert ai_providers.status(provider)["reachable"] is False
    with pytest.raises(ValueError, match="respuesta"):
        agent_chat.chat(provider, "invalid", [{"role": "user", "content": "Hola"}], with_tools=False)


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
def test_provider_error_cannot_echo_key_to_renderer(provider_server, provider):
    base, _ = provider_server
    ai_providers.put_config(provider, {"api_key": "test-key-1234", "base_url": base})
    with pytest.raises(ValueError, match="401") as error:
        agent_chat.chat(provider, "echo-key", [{"role": "user", "content": "Hola"}], with_tools=False)
    assert "test-key-1234" not in str(error.value)


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
def test_streaming_text_and_fragmented_tool_arguments(provider_server, monkeypatch, provider):
    base, requests = provider_server
    ai_providers.put_config(provider, {"api_key": "test-key-1234", "base_url": base + "/v1"})
    monkeypatch.setattr(agent_chat, "tool_specs", lambda: [])
    reply = agent_chat.chat(provider, "stream", [{"role": "user", "content": "Hola"}])
    assert reply == {"text": "Sí", "calls": [{"id": "call-1", "name": "formats", "params": {"n": 2}}]}
    assert len(requests) == 1


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
@pytest.mark.parametrize("model", ["stream-incomplete", "stream-error", "stream-bad-arguments", "bad-json", "invalid-tools", "invalid-text"])
def test_broken_response_never_returns_partial_success_or_retries(provider_server, provider, model):
    base, requests = provider_server
    ai_providers.put_config(provider, {"api_key": "test-key-1234", "base_url": base})
    with pytest.raises(ValueError, match="proveedor") as error:
        agent_chat.chat(provider, model, [{"role": "user", "content": "Hola"}], with_tools=False)
    assert "test-key-1234" not in str(error.value)
    assert len(requests) == 1


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
@pytest.mark.parametrize("suffix", ["/bad-json", "/oversized"])
def test_status_invalid_or_oversized_json_is_a_controlled_failure(provider_server, monkeypatch, provider, suffix):
    base, _ = provider_server
    monkeypatch.setattr(ai_providers, "_MAX_RESPONSE_BYTES", 100, raising=False)
    ai_providers.put_config(provider, {"api_key": "test-key", "base_url": base + suffix})
    result = ai_providers.status(provider)
    assert result["reachable"] is False
    assert result["error"]


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
def test_streaming_matches_native_sdk_over_http(provider_server, monkeypatch, provider):
    sdk = pytest.importorskip(provider)
    base, requests = provider_server
    base_url = base + "/gateway" + ("/v1" if provider == "openai" else "")
    ai_providers.put_config(provider, {"api_key": "test-key-1234", "base_url": base_url})
    monkeypatch.setattr(agent_chat, "tool_specs", lambda: [])
    messages = [{"role": "user", "content": "Hola"}]
    actual = agent_chat.chat(provider, "stream", messages, with_tools=False, system="Prueba")
    if provider == "openai":
        with (
            sdk.OpenAI(api_key="test-key-1234", base_url=base_url) as client,
            client.chat.completions.stream(model="stream", messages=agent_chat._openai_wire(messages, "Prueba")) as stream,
        ):
            for _ in stream:
                pass
            final = stream.get_final_completion().choices[0].message
        assert actual["text"] == final.content
        assert actual["calls"][0]["params"] == json.loads(final.tool_calls[0].function.arguments)
    else:
        with (
            sdk.Anthropic(api_key="test-key-1234", base_url=base_url) as client,
            client.messages.stream(model="stream", messages=messages, max_tokens=2048, system="Prueba") as stream,
        ):
            final = stream.get_final_message()
        assert actual["text"] == final.content[0].text
        assert actual["calls"][0]["params"] == final.content[1].input
    assert requests[-1][0] == requests[-2][0]
    assert requests[-1][2] == requests[-2][2]


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
@pytest.mark.parametrize("model", ["stream-text", "stream-error"])
def test_saved_provider_sends_turn_and_persists_streamed_response(provider_server, tmp_path, monkeypatch, caplog, provider, model):
    base, requests = provider_server
    flow_handlers._ai_provider_save({"provider": provider, "api_key": "test-key-1234", "base_url": base + "/v1", "model": model})
    store = agent.AgentStore(tmp_path / "agent")
    runner = agent.AgentRunner(store, lambda name: None)
    monkeypatch.setattr(agent_handlers, "_store", lambda: store)
    monkeypatch.setattr(agent_handlers, "_runner", lambda: runner)
    monkeypatch.setattr(agent_chat, "tool_specs", lambda: [])
    session_id = agent_handlers._session_create({"provider": provider})["session"]["id"]
    assert agent_handlers._message_send({"session_id": session_id, "content": "Hola"}) == {"accepted": True}
    with runner._lock:
        worker = runner._running.get(session_id)
    if worker:
        worker.join(timeout=5)
    assert agent_handlers._turn_status({"session_id": session_id})["running"] is False
    result = agent_handlers._messages_list({"session_id": session_id})
    if model == "stream-text":
        assert [m["content"] for m in result["messages"]] == ["Hola", "Sí"]
        assert store.get_session(session_id)["last_error"] is None
    else:
        assert "Error del agente" in result["messages"][-1]["content"]
        assert store.get_session(session_id)["last_error"]
        assert "test-key-1234" not in json.dumps(result) + caplog.text
    assert len(requests) == 1


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
def test_streaming_response_size_is_bounded(provider_server, monkeypatch, provider):
    base, requests = provider_server
    ai_providers.put_config(provider, {"api_key": "test-key", "base_url": base})
    monkeypatch.setattr(agent_chat, "_MAX_RESPONSE_BYTES", 100)
    with pytest.raises(ValueError, match="tamaño máximo"):
        agent_chat.chat(provider, "stream", [{"role": "user", "content": "Hola"}], with_tools=False)
    assert len(requests) == 1


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
def test_transient_http_error_retries_are_bounded_with_invalid_retry_after(provider_server, monkeypatch, provider):
    base, requests = provider_server
    ai_providers.put_config(provider, {"api_key": "test-key", "base_url": base})
    delays = []
    monkeypatch.setattr(agent_chat.time, "sleep", delays.append)
    assert agent_chat.chat(provider, "retry", [{"role": "user", "content": "Hola"}], with_tools=False)["text"] == "Listo"
    assert len(requests) == 3
    assert delays == [0, 0]
