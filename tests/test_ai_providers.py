import pytest

from backend.core.integrations import ai_providers


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


def _custom(**overrides):
    data = {
        "label": "Mi modelo",
        "api": "openai",
        "base_url": "https://gateway.example.com/v1",
        "model": "mi-modelo",
        "api_key": "sk-custom-9876",
    }
    data.update(overrides)
    return data


def test_custom_model_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_providers, "user_data_path", lambda rel: tmp_path / rel)
    created = ai_providers.upsert_custom(_custom())

    provider = created["id"]
    assert provider.startswith("custom-mi-modelo-")
    state = ai_providers.public_state(provider)
    assert state["has_key"] is True
    assert state["key_masked"] == "••••9876"
    assert state["default_model"] == "mi-modelo"
    assert state["needs_key"] is True
    assert "sk-custom-9876" not in str(state)

    spec = ai_providers.get_provider(provider)
    assert spec["custom"] is True
    assert spec["chat"]["style"] == "openai_chat"
    assert ai_providers.load_provider_specs()[provider]["label"] == "Mi modelo"

    ai_providers.delete_config(provider)
    assert ai_providers.get_config(provider) is None
    assert provider not in ai_providers.load_provider_specs()


def test_custom_model_edit_keeps_key_and_allows_keyless(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_providers, "user_data_path", lambda rel: tmp_path / rel)
    provider = ai_providers.upsert_custom(_custom())["id"]

    ai_providers.upsert_custom({"id": provider, "label": "Mi modelo", "api": "anthropic",
                                "base_url": "https://gateway.example.com", "model": "otro"})
    assert ai_providers.get_config(provider)["api_key"] == "sk-custom-9876"
    spec = ai_providers.get_provider(provider)
    assert spec["chat"]["style"] == "anthropic_messages"
    assert spec["auth"]["type"] == "api_key"

    other = ai_providers.upsert_custom(_custom(label="Local", api_key="", base_url="http://127.0.0.1:8080/v1"))["id"]
    assert ai_providers.public_state(other)["needs_key"] is False
    assert ai_providers.get_provider(other)["auth"]["type"] == "none"


def test_custom_model_can_remove_its_key(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_providers, "user_data_path", lambda rel: tmp_path / rel)
    provider = ai_providers.upsert_custom(_custom())["id"]

    ai_providers.upsert_custom(_custom(id=provider, remove_key=True, api_key=""))
    assert "api_key" not in ai_providers.get_config(provider)
    assert ai_providers.public_state(provider)["needs_key"] is False
    assert ai_providers.get_provider(provider)["auth"]["type"] == "none"

    ai_providers.upsert_custom(_custom(id=provider, api_key="sk-nueva"))
    assert ai_providers.public_state(provider)["key_masked"] == "••••ueva"


def test_custom_model_validates_input(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_providers, "user_data_path", lambda rel: tmp_path / rel)
    cases = [
        (_custom(label="  "), "nombre"),
        (_custom(api="bedrock"), "formato de API"),
        (_custom(base_url=""), "dirección base"),
        (_custom(base_url="file:///etc/passwd"), "http"),
        (_custom(model="x" * 129), "modelo"),
    ]
    for payload, message in cases:
        with pytest.raises(ValueError, match=message):
            ai_providers.upsert_custom(payload)
    with pytest.raises(ValueError, match="desconocido"):
        ai_providers.upsert_custom(_custom(id="custom-no-existe"))
    with pytest.raises(ValueError, match="id"):
        ai_providers.upsert_custom(_custom(id=123))


def test_custom_model_status_uses_its_api_format(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_providers, "user_data_path", lambda rel: tmp_path / rel)
    seen = {}

    def fake_get(url, headers):
        seen["url"] = url
        seen["headers"] = headers
        return {"data": [{"id": "mi-modelo"}]}

    monkeypatch.setattr(ai_providers, "_get_json", fake_get)
    openai_id = ai_providers.upsert_custom(_custom())["id"]
    anthropic_id = ai_providers.upsert_custom(
        _custom(label="Claude local", api="anthropic", base_url="https://proxy.example.com", api_key="ak-1")
    )["id"]

    assert ai_providers.status(openai_id)["reachable"] is True
    assert seen["url"] == "https://gateway.example.com/v1/models"
    assert seen["headers"]["Authorization"] == "Bearer sk-custom-9876"

    ai_providers.status(anthropic_id)
    assert seen["url"] == "https://proxy.example.com/v1/models"
    assert seen["headers"]["x-api-key"] == "ak-1"
    assert seen["headers"]["anthropic-version"] == "2023-06-01"


def test_catalog_providers_still_resolve_with_custom_models(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_providers, "user_data_path", lambda rel: tmp_path / rel)
    ai_providers.upsert_custom(_custom())
    specs = ai_providers.load_provider_specs()
    assert specs["openai"]["auth"]["type"] == "api_key"
    assert "custom" not in specs["openai"]


def test_ipc_list_exposes_custom_models_without_the_key(tmp_path, monkeypatch):
    from backend.handlers import integrations

    monkeypatch.setattr(ai_providers, "user_data_path", lambda rel: tmp_path / rel)
    created = integrations.HANDLERS["ai_provider_custom_save"]({
        "label": "Mi gateway",
        "api": "openai",
        "base_url": "https://gateway.example.com/v1",
        "model": "mi-modelo",
        "api_key": "sk-secreto",
    })
    provider = created["id"]

    listed = integrations.HANDLERS["ai_providers_list"]({})
    entry = next(item for item in listed["providers"] if item["id"] == provider)
    assert entry["custom"] is True
    assert entry["api"] == "openai"
    assert entry["default_model"] == "mi-modelo"
    assert entry["has_key"] is True
    assert "sk-secreto" not in str(listed)
    assert all("custom" not in item for item in listed["providers"] if item["id"] != provider)


def test_ipc_list_keeps_catalog_before_custom_models(tmp_path, monkeypatch):
    """Agente y Diseño usan el primer proveedor listo: un custom no debe adelantarse."""
    from backend.handlers import integrations

    monkeypatch.setattr(ai_providers, "user_data_path", lambda rel: tmp_path / rel)
    created = integrations.HANDLERS["ai_provider_custom_save"]({
        "label": "AAA",
        "api": "openai",
        "base_url": "https://gateway.example.com/v1",
        "model": "mi-modelo",
        "api_key": "sk-secreto",
    })
    ids = [item["id"] for item in integrations.HANDLERS["ai_providers_list"]({})["providers"]]
    builtins = [pid for pid in ids if not pid.startswith("custom-")]
    assert builtins == sorted(builtins)
    assert ids.index("openai") < ids.index(created["id"])
    assert all(ids.index(pid) < ids.index(created["id"]) for pid in builtins)


def test_custom_model_with_corrupt_vault_can_be_deleted(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_providers, "user_data_path", lambda rel: tmp_path / rel)
    path = tmp_path / "ai-providers" / "custom-roto-aaaaaa.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("no-es-json", encoding="utf-8")

    with pytest.raises(ValueError):
        ai_providers.get_provider("custom-roto-aaaaaa")

    ai_providers.delete_config("custom-roto-aaaaaa")
    assert not path.exists()

