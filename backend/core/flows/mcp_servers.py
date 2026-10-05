"""Registro de servidores MCP del usuario para Flujos.

Los servidores se guardan en ``mcp_servers.json`` dentro de datos de usuario;
los secretos (cabeceras HTTP, env de procesos stdio) viven en el vault sellado
de ``core.flows.vault`` y nunca salen del backend — el listado público solo
expone los nombres de las claves.
"""

from __future__ import annotations

import contextlib
import hashlib
import ipaddress
import json
import os
import re
import threading
import time
import urllib.parse
from pathlib import Path

from backend.core.flows import http_guard, mcp_client, vault
from backend.core.flows.expr import resolve
from backend.core.flows.types import JsonObject
from backend.utils.atomic_write import atomic_write_json
from backend.utils.paths import user_data_path

_lock = threading.RLock()
_TOOLS_TTL_S = 300.0
_tools_cache: dict[str, tuple[float, list[JsonObject]]] = {}

_ID_RE = re.compile(r"[^a-z0-9_-]+")
_TOOL_NAME_RE = re.compile(r"[^a-zA-Z0-9_-]+")
MAX_SERVERS = 20
_MAX_SECRET_CHARS = 4000


def _servers_path() -> Path:
    return user_data_path("mcp_servers.json")


def _secrets_path(server_id: str) -> Path:
    return user_data_path(f"mcp/{server_id}-secrets.json")


def _slug(name: str) -> str:
    slug = _ID_RE.sub("-", name.lower()).strip("-")
    return slug[:48] or "servidor"


def _is_loopback_url(url: str) -> bool:
    """``http://`` solo se tolera hacia loopback: el tráfico no sale de la máquina."""
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    if host == "localhost" or host.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _load() -> list[JsonObject]:
    path = _servers_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [s for s in data.get("servers", []) if isinstance(s, dict)]


def _save(servers: list[JsonObject]) -> None:
    atomic_write_json(_servers_path(), {"servers": servers})


def _public(server: JsonObject) -> JsonObject:
    secrets = vault.open_sealed(f"mcp:{server['id']}", _secrets_path(server["id"])) or {}
    return {
        "id": server["id"],
        "name": server["name"],
        "transport": server["transport"],
        "url": server.get("url", ""),
        "command": server.get("command", ""),
        "args": server.get("args", []),
        "secret_keys": sorted((secrets.get("headers") or {}).keys() or (secrets.get("env") or {}).keys()),
        "tools_count": server.get("tools_count"),
    }


def list_servers() -> list[JsonObject]:
    with _lock:
        return [_public(s) for s in _load()]


def get_server(server_id: str) -> JsonObject:
    for s in _load():
        if s.get("id") == server_id:
            return s
    raise ValueError(f"Servidor MCP desconocido: {server_id}")


def add_server(
    name: str,
    transport: str,
    *,
    url: str = "",
    command: str = "",
    args: list[str] | None = None,
    secrets: JsonObject | None = None,
) -> JsonObject:
    """Registra un servidor. ``secrets``: {'headers'|'env': {clave: valor}}."""
    name = name.strip()
    if not name or len(name) > 80:
        raise ValueError("Nombre de servidor inválido")
    if transport not in ("http", "stdio"):
        raise ValueError("transport debe ser http o stdio")
    if transport == "http":
        url = url.strip()
        if not url.startswith(("http://", "https://")):
            raise ValueError("La URL del servidor debe empezar por http(s)://")
        if url.startswith("http://") and not (_is_loopback_url(url) or http_guard._private_hosts_allowed()):
            raise ValueError(
                "Las URLs http:// envían las credenciales sin cifrar; usa https:// "
                "(http:// solo se admite en localhost)"
            )
    else:
        command = command.strip()
        if not command:
            raise ValueError("El servidor stdio requiere un comando")
    with _lock:
        servers = _load()
        if len(servers) >= MAX_SERVERS:
            raise ValueError(f"Máximo {MAX_SERVERS} servidores MCP")
        base = _slug(name)
        server_id = base
        i = 2
        while any(s.get("id") == server_id for s in servers):
            server_id = f"{base}-{i}"
            i += 1
        server: JsonObject = {
            "id": server_id,
            "name": name,
            "transport": transport,
            "url": url,
            "command": command,
            "args": [str(a) for a in (args or [])][:32],
        }
        servers.append(server)
        _save(servers)
        if secrets:
            flat: dict[str, dict[str, str]] = {}
            for group in ("headers", "env"):
                values = secrets.get(group)
                if isinstance(values, dict):
                    flat[group] = {
                        str(k): str(v)[:_MAX_SECRET_CHARS] for k, v in list(values.items())[:16] if str(v).strip()
                    }
            if any(flat.values()):
                vault.seal(f"mcp:{server_id}", _secrets_path(server_id), flat)
        return _public(server)


def remove_server(server_id: str) -> JsonObject:
    with _lock:
        servers = _load()
        kept = [s for s in servers if s.get("id") != server_id]
        if len(kept) == len(servers):
            raise ValueError(f"Servidor MCP desconocido: {server_id}")
        _save(kept)
        _tools_cache.pop(server_id, None)
    with contextlib.suppress(OSError):
        _secrets_path(server_id).unlink(missing_ok=True)
    return {"deleted": True, "id": server_id}


def _secrets(server_id: str) -> JsonObject:
    return vault.open_sealed(f"mcp:{server_id}", _secrets_path(server_id)) or {}


def _stdio_env(secrets: JsonObject) -> dict[str, str]:
    env = dict(os.environ)
    for k, v in (secrets.get("env") or {}).items():
        env[str(k)] = str(v)
    return env


def list_tools(server_id: str, *, force: bool = False) -> list[JsonObject]:
    server = get_server(server_id)
    with _lock:
        cached = _tools_cache.get(server_id)
        if cached and not force and time.time() - cached[0] < _TOOLS_TTL_S:
            return cached[1]
    secrets = _secrets(server_id)
    if server["transport"] == "http":
        tools = mcp_client.list_tools_http(server["url"], secrets.get("headers") or {})
    else:
        tools = mcp_client.list_tools_stdio(server["command"], server.get("args") or [], _stdio_env(secrets))
    clean = [
        {
            "name": str(t.get("name") or ""),
            "description": str(t.get("description") or "")[:300],
            "inputSchema": t.get("inputSchema") if isinstance(t.get("inputSchema"), dict) else {"type": "object", "properties": {}},
        }
        for t in tools
        if isinstance(t, dict) and t.get("name")
    ]
    with _lock:
        _tools_cache[server_id] = (time.time(), clean)
        servers = _load()
        for s in servers:
            if s.get("id") == server_id:
                s["tools_count"] = len(clean)
        _save(servers)
    return clean


def call_tool(server_id: str, tool: str, args: JsonObject, *, advertised: bool = False) -> JsonObject:
    server = get_server(server_id)
    secrets = _secrets(server_id)
    tool = _resolve_tool_name(server_id, tool, advertised=advertised)
    if server["transport"] == "http":
        result = mcp_client.call_tool_http(server["url"], secrets.get("headers") or {}, tool, args)
    else:
        result = mcp_client.call_tool_stdio(
            server["command"],
            server.get("args") or [],
            _stdio_env(secrets),
            tool,
            args,
        )
    return mcp_client.normalize_result(result)


def run_mcp_call_node(node: JsonObject, memory: JsonObject) -> JsonObject:
    """Ejecuta el nodo de flujo ``mcp_call`` y devuelve ``{"json": resultado}``."""
    config = node.get("config") or {}
    server = str(config.get("server") or "").strip()
    tool = str(config.get("tool") or "").strip()
    if not server or not tool:
        raise ValueError("mcp_call requiere config.server y config.tool")
    args = resolve(config.get("args"), memory)
    result = call_tool(server, tool, args if isinstance(args, dict) else {})
    if result.get("isError"):
        raise ValueError(f"La tool MCP {server}/{tool} devolvió error: {result.get('text', '')[:200]}")
    return {"json": result}


def agent_tool_name(server_id: str, tool: str) -> str:
    """Nombre anunciado al LLM: un function name válido (<=64, [A-Za-z0-9_-])."""
    alias = f"{server_id[:19]}-{hashlib.sha256(server_id.encode()).hexdigest()[:12]}"
    prefix = f"mcp2__{alias}__"
    clean = _TOOL_NAME_RE.sub('-', tool)
    if tool:
        clean = f"{clean[:64 - len(prefix) - 13]}-{hashlib.sha256(tool.encode()).hexdigest()[:12]}"
    return prefix + clean


def _resolve_tool_name(server_id: str, name: str, *, advertised: bool = False) -> str:
    """Traduce el nombre anunciado al agente al real de la tool.

    Devuelve ``name`` intacto si ya es el nombre real o si no se puede listar
    el servidor (el error real lo da la propia llamada).
    """
    try:
        tools = list_tools(server_id)
    except Exception:
        if advertised:
            raise ValueError("No se pudo verificar la herramienta MCP aprobada") from None
        return name
    if not advertised and any(str(tool.get("name") or "") == name for tool in tools):
        return name
    full_name = name if advertised else f"mcp__{server_id}__{name}"
    matches = []
    for t in tools:
        real = str(t.get("name") or "")
        legacy = f"mcp__{server_id}__{_TOOL_NAME_RE.sub('-', real)}"[:64]
        if agent_tool_name(server_id, real) == full_name or legacy == full_name:
            matches.append(real)
    if len(matches) > 1:
        raise ValueError("Nombre MCP ambiguo; vuelve a solicitar la herramienta antes de aprobar")
    if matches:
        return matches[0]
    if advertised:
        raise ValueError("La herramienta MCP aprobada ya no está disponible")
    return name


def parse_agent_tool(name: str) -> tuple[str, str] | None:
    """Resuelve nombres MCP actuales y antiguos; rechaza identidades ambiguas."""
    if name.startswith("mcp2__"):
        for server in list_servers():
            server_id = str(server["id"])
            prefix = agent_tool_name(server_id, "")
            if name.startswith(prefix) and name[len(prefix):]:
                return server_id, name[len(prefix):]
        return None
    if not name.startswith("mcp__"):
        return None
    matches = []
    for server in list_servers():
        prefix = f"mcp__{server['id']}__"
        if name.startswith(prefix) and name[len(prefix):]:
            matches.append((str(server["id"]), name[len(prefix):]))
    if len(matches) > 1:
        raise ValueError("Nombre MCP ambiguo; vuelve a solicitar la herramienta antes de aprobar")
    if matches:
        return matches[0]
    rest = name[5:]
    if "__" not in rest:
        return None
    server_id, tool = rest.split("__", 1)
    if not server_id or not tool:
        return None
    return server_id, tool
