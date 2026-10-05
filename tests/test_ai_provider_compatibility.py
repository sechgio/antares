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
            if self.path.startswith("/no-models/"):
                self.reply({"error": "not found"}, 404)
            elif self.path.startswith("/invalid/"):
                self.reply({"error": "unsupported"})
            else:
                self.reply({"data": [{"id": "custom-model"}]})

        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append((self.path, dict(self.headers), payload))
            if payload["model"] == "invalid":
                self.reply({"error": "unsupported"})
            elif payload["model"] == "echo-key":
                self.reply({"error": self.headers.get("Authorization") or self.headers.get("x-api-key")}, 401)
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
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())

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
