from __future__ import annotations

import json

import pytest

from backend.core.integrations import mcp_client, mcp_servers, vault


@pytest.fixture()
def mcp_root(tmp_path, monkeypatch):
    monkeypatch.setattr(mcp_servers, "user_data_path", lambda rel: tmp_path / rel)
    monkeypatch.setattr(vault, "user_data_path", lambda rel: tmp_path / rel)
    return tmp_path


def test_add_server_oauth_keeps_secret_in_vault_only(mcp_root):
    server = mcp_servers.add_server(
        "Remoto OAuth", "http", url="https://mcp.ejemplo.com/mcp",
        oauth={"token_url": "https://mcp.ejemplo.com/token", "client_id": "cid",
               "client_secret": "super-secreto", "scopes": ["read", "write"]},
    )
    assert server["oauth"] == {"token_url": "https://mcp.ejemplo.com/token", "client_id": "cid", "scopes": ["read", "write"]}
    assert server["secret_keys"] == ["client_secret"]
    assert "super-secreto" not in json.dumps(server)
    sealed = vault.open_sealed(f"mcp:{server['id']}", mcp_servers._secrets_path(server["id"]))
    assert sealed["oauth"] == {"client_secret": "super-secreto"}
    with pytest.raises(ValueError, match="OAuth solo"):
        mcp_servers.add_server("Stdio OAuth", "stdio", command="npx",
                               oauth={"token_url": "https://t.example/token", "client_id": "cid"})
    with pytest.raises(ValueError, match="https"):
        mcp_servers.add_server("Token inseguro", "http", url="https://mcp.ejemplo.com/mcp",
                               oauth={"token_url": "http://token.ejemplo.com/token", "client_id": "cid"})
    with pytest.raises(ValueError, match="client_id"):
        mcp_servers.add_server("Sin cliente", "http", url="https://mcp.ejemplo.com/mcp",
                               oauth={"token_url": "https://t.example/token", "client_id": " "})


def test_client_credentials_token_caches_and_force_refreshes(monkeypatch):
    monkeypatch.setattr(mcp_client, "_TOKEN_CACHE", {})
    posts: list[tuple[str, dict[str, str]]] = []

    def fake_post(url, fields):
        posts.append((url, dict(fields)))
        return {"access_token": f"tok-{len(posts)}", "expires_in": 3600}

    monkeypatch.setattr(mcp_client, "_token_post", fake_post)
    assert mcp_client.client_credentials_token("https://t.example/token", "cid", "sec", ["read"]) == "tok-1"
    assert mcp_client.client_credentials_token("https://t.example/token", "cid", "sec") == "tok-1"
    assert len(posts) == 1
    assert posts[0] == ("https://t.example/token", {
        "grant_type": "client_credentials", "client_id": "cid", "client_secret": "sec", "scope": "read",
    })
    assert mcp_client.client_credentials_token("https://t.example/token", "cid", "sec", force=True) == "tok-2"
    mcp_client.clear_client_token("https://t.example/token", "cid")
    assert mcp_client.client_credentials_token("https://t.example/token", "cid") == "tok-3"


def test_http_with_401_retry_renews_token_once(mcp_root, monkeypatch):
    server = mcp_servers.add_server(
        "Retry", "http", url="https://mcp.ejemplo.com/mcp",
        oauth={"token_url": "https://t.example/token", "client_id": "cid",
               "client_secret": "sec", "scopes": ["read"]},
    )
    secrets = mcp_servers._secrets(server["id"])
    forces: list[bool] = []

    def fake_token(token_url, client_id, client_secret="", scopes=None, *, force=False):
        forces.append(force)
        return "tok-b" if force else "tok-a"

    monkeypatch.setattr(mcp_client, "client_credentials_token", fake_token)
    seen: list[str | None] = []
    outcomes = iter([mcp_client.McpError("El servidor MCP respondió HTTP 401: token vencido"), {"ok": True}])

    def call(headers):
        seen.append(headers.get("Authorization"))
        outcome = next(outcomes)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    assert mcp_servers._http_with_401_retry(mcp_servers.get_server(server["id"]), secrets, call) == {"ok": True}
    assert seen == ["Bearer tok-a", "Bearer tok-b"]
    assert forces == [False, True]


def test_http_without_oauth_propagates_401_without_retry(mcp_root, monkeypatch):
    server = mcp_servers.add_server(
        "Plano", "http", url="https://mcp.ejemplo.com/mcp",
        secrets={"headers": {"Authorization": "Bearer estatico"}},
    )
    attempts: list[dict[str, str]] = []

    def call(headers):
        attempts.append(headers)
        raise mcp_client.McpError("El servidor MCP respondió HTTP 401: sin token válido")

    with pytest.raises(mcp_client.McpError):
        mcp_servers._http_with_401_retry(mcp_servers.get_server(server["id"]), mcp_servers._secrets(server["id"]), call)
    assert len(attempts) == 1
    assert attempts[0] == {"Authorization": "Bearer estatico"}
