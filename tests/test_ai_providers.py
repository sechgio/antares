import pytest

from backend.core.flows import ai_providers


def test_provider_specs_loaded():
    specs = ai_providers.load_provider_specs()
    assert {"openai", "anthropic", "ollama"} <= set(specs)
    assert specs["openai"]["auth"]["type"] == "api_key"
    assert specs["ollama"]["auth"]["type"] == "none"


def test_config_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_providers, "user_data_path", lambda rel: tmp_path / rel)
    ai_providers.put_config("openai", {"api_key": "sk-test-1234", "base_url": "https://api.openai.com/v1"})
    cfg = ai_providers.get_config("openai")
    assert cfg is not None and cfg["api_key"] == "sk-test-1234"
    state = ai_providers.public_state("openai")
    assert state["has_key"] is True
    assert state["key_masked"] == "••••1234"
    assert "sk-test-1234" not in str(state)
    ai_providers.delete_config("openai")
    assert ai_providers.get_config("openai") is None


def test_config_merge_keeps_key(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_providers, "user_data_path", lambda rel: tmp_path / rel)
    ai_providers.put_config("openai", {"api_key": "sk-1"})
    ai_providers.put_config("openai", {"base_url": "https://proxy.example.com/v1"})
    cfg = ai_providers.get_config("openai")
    assert cfg["api_key"] == "sk-1"
    assert ai_providers.public_state("openai")["base_url"] == "https://proxy.example.com/v1"


def test_base_url_validated(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_providers, "user_data_path", lambda rel: tmp_path / rel)
    with pytest.raises(ValueError, match="http"):
        ai_providers.put_config("openai", {"base_url": "file:///etc/passwd"})


def test_unknown_provider_rejected():
    with pytest.raises(ValueError, match="desconocido"):
        ai_providers.put_config("nope", {"api_key": "x"})
    with pytest.raises(ValueError, match="desconocido"):
        ai_providers.status("nope")


def test_status_counts_models(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_providers, "user_data_path", lambda rel: tmp_path / rel)
    ai_providers.put_config("openai", {"api_key": "sk-x"})
    seen = {}

    def fake_get(url, headers):
        seen["url"] = url
        seen["headers"] = headers
        return {"data": [{"id": "gpt-4o"}, {"id": "gpt-4o-mini"}]}

    monkeypatch.setattr(ai_providers, "_get_json", fake_get)
    st = ai_providers.status("openai")
    assert st["reachable"] is True and st["models_count"] == 2
    assert seen["url"] == "https://api.openai.com/v1/models"
    assert seen["headers"]["Authorization"] == "Bearer sk-x"


def test_status_anthropic_header(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_providers, "user_data_path", lambda rel: tmp_path / rel)
    ai_providers.put_config("anthropic", {"api_key": "ak-y"})
    seen = {}

    def fake_get(url, headers):
        seen["headers"] = headers
        return {"data": [{"id": "claude-4"}]}

    monkeypatch.setattr(ai_providers, "_get_json", fake_get)
    st = ai_providers.status("anthropic")
    assert st["reachable"] is True
    assert seen["headers"]["x-api-key"] == "ak-y"
    assert seen["headers"]["anthropic-version"] == "2023-06-01"


def test_status_missing_key(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_providers, "user_data_path", lambda rel: tmp_path / rel)
    st = ai_providers.status("openai")
    assert st["reachable"] is False
    assert "API key" in st["error"]


def test_status_ollama_no_key_needed(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_providers, "user_data_path", lambda rel: tmp_path / rel)
    ai_providers.put_config("ollama", {"base_url": "http://127.0.0.1:11434"})
    seen = {}

    def fake_get(url, headers):
        seen["url"] = url
        seen["headers"] = headers
        return {"models": [{"name": "llama3.1"}]}

    monkeypatch.setattr(ai_providers, "_get_json", fake_get)
    st = ai_providers.status("ollama")
    assert st["reachable"] is True and st["models_count"] == 1
    assert "Authorization" not in seen["headers"]
    assert seen["url"] == "http://127.0.0.1:11434/api/tags"


def test_status_http_error(tmp_path, monkeypatch):
    import urllib.error

    monkeypatch.setattr(ai_providers, "user_data_path", lambda rel: tmp_path / rel)
    ai_providers.put_config("openai", {"api_key": "sk-x"})

    def fake_get(url, headers):
        raise urllib.error.HTTPError(url, 401, "unauthorized", {}, None)

    monkeypatch.setattr(ai_providers, "_get_json", fake_get)
    st = ai_providers.status("openai")
    assert st["reachable"] is False and "401" in st["error"]
