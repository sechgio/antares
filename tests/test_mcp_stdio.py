"""Refuerzos py-008 para servidores MCP stdio: aprobación vigente, PATH de runtime y redacción de errores."""
from __future__ import annotations

import pytest

from backend.core.integrations import mcp_client, mcp_servers, vault


@pytest.fixture()
def mcp_root(tmp_path, monkeypatch):
    monkeypatch.setattr(mcp_servers, "user_data_path", lambda rel: tmp_path / rel)
    monkeypatch.setattr(vault, "user_data_path", lambda rel: tmp_path / rel)
    return tmp_path


def test_stdio_call_requires_fresh_approval_context(mcp_root):
    server = mcp_servers.add_server("SinContexto", "stdio", command="x")
    with pytest.raises(ValueError, match="contexto de aprobación"):
        # El freno dispara antes de arrancar cualquier proceso: «x» nunca se ejecuta.
        mcp_servers.call_tool(server["id"], "echo", {})


def test_stdio_env_secrets_cannot_override_runtime_keys(mcp_root):
    server = mcp_servers.add_server("Claves", "stdio", command="x",
                                    secrets={"env": {"PATH": "C:\\malo", "API_KEY": "s3cr3t"}})
    env = mcp_servers._stdio_env(mcp_servers._secrets(server["id"]))
    assert env.get("API_KEY") == "s3cr3t"
    assert "C:\\malo" not in env.get("PATH", "")
    assert env.get("PATH"), "el PATH del proceso sigue vivo para el servidor stdio"


def test_list_tools_failure_redacts_secrets_in_raised_error(mcp_root, monkeypatch):
    server = mcp_servers.add_server("Fuga", "stdio", command="x", secrets={"env": {"TOKEN": "sk-super-secreto"}})
    def _fallo(*args, **kwargs):
        raise RuntimeError("handshake falló con TOKEN=sk-super-secreto")
    monkeypatch.setattr(mcp_client, "list_tools_stdio", _fallo)
    with pytest.raises(ValueError, match="REDACTED") as raised:
        mcp_servers.list_tools(server["id"], force=True)
    assert "sk-super-secreto" not in str(raised.value)
