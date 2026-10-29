from __future__ import annotations

import contextlib
import hashlib
import ipaddress
import json
import os
import re
import threading
import time
import unicodedata
import urllib.parse
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar

from backend.core.integrations import http_guard, mcp_client, vault
from backend.core.integrations.types import JsonObject
from backend.utils.atomic_write import atomic_write_json
from backend.utils.paths import user_data_path

_lock = threading.RLock()
_TOOLS_TTL_S = 300.0
_tools_cache: dict[str, tuple[float, list[JsonObject]]] = {}
_tools_status: dict[str, JsonObject] = {}

_ID_RE = re.compile(r"[^a-z0-9_-]+")
_TOOL_NAME_RE = re.compile(r"[^a-zA-Z0-9_-]+")
MAX_SERVERS = 20
_MAX_SECRET_CHARS = 4000

_T = TypeVar("_T")


def _servers_path() -> Path:
    return user_data_path("mcp_servers.json")


def _secrets_path(server_id: str) -> Path:
    return user_data_path(f"mcp/{server_id}-secrets.json")


def _slug(name: str) -> str:
    slug = _ID_RE.sub("-", name.lower()).strip("-")
    return slug[:48] or "servidor"


def _is_loopback_url(url: str) -> bool:
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
    public: JsonObject = {
        "id": server["id"],
        "name": server["name"],
        "transport": server["transport"],
        "url": server.get("url", ""),
        "command": server.get("command", ""),
        "args": server.get("args", []),
        "secret_keys": sorted({key for group in ("headers", "env", "oauth") for key in (secrets.get(group) or {})}),
        "tools_count": server.get("tools_count"),
        "disabled_tools": server.get("disabled_tools", []),
    }
    if server.get("oauth"):
        public["oauth"] = server["oauth"]
    return public


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
    oauth: JsonObject | None = None,
) -> JsonObject:
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
    oauth_spec: JsonObject | None = None
    if oauth:
        if transport != "http":
            raise ValueError("OAuth solo está disponible para servidores MCP HTTP")
        token_url = str(oauth.get("token_url") or "").strip()
        client_id = str(oauth.get("client_id") or "").strip()[:256]
        if not token_url.startswith("https://") and not (_is_loopback_url(token_url) or http_guard._private_hosts_allowed()):
            raise ValueError("La URL del endpoint de token debe usar https:// (http:// solo se admite en localhost)")
        if not client_id:
            raise ValueError("OAuth requiere un client_id")
        if "client_secret" in oauth and not isinstance(oauth.get("client_secret"), str):
            raise ValueError("client_secret debe ser un texto")
        scopes_raw = oauth.get("scopes")
        if scopes_raw is not None and (
            not isinstance(scopes_raw, list) or len(scopes_raw) > 16 or any(not isinstance(s, str) for s in scopes_raw)
        ):
            raise ValueError("scopes debe ser una lista de hasta 16 textos")
        oauth_spec = {
            "token_url": token_url[:2048],
            "client_id": client_id,
            "scopes": [str(s).strip() for s in (scopes_raw or []) if str(s).strip()][:16],
        }
    oauth_secret = str((oauth or {}).get("client_secret") or "").strip()[:_MAX_SECRET_CHARS]
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
        if oauth_spec:
            server["oauth"] = oauth_spec
        servers.append(server)
        _save(servers)
        if secrets or oauth_secret:
            flat: dict[str, dict[str, str]] = {}
            for group in ("headers", "env"):
                values = secrets.get(group, {}) if isinstance(secrets, dict) else {}
                if isinstance(values, dict):
                    flat[group] = {
                        str(k): str(v)[:_MAX_SECRET_CHARS] for k, v in list(values.items())[:16] if str(v).strip()
                    }
            if oauth_secret:
                flat["oauth"] = {"client_secret": oauth_secret}
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
        _tools_status.pop(server_id, None)
    with contextlib.suppress(OSError):
        _secrets_path(server_id).unlink(missing_ok=True)
    return {"deleted": True, "id": server_id}


def _secrets(server_id: str) -> JsonObject:
    return vault.open_sealed(f"mcp:{server_id}", _secrets_path(server_id)) or {}


def _stdio_env(secrets: JsonObject) -> dict[str, str]:
    runtime_keys = {"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "USERPROFILE",
                    "HOME", "APPDATA", "LOCALAPPDATA", "LANG", "LC_ALL", "LC_CTYPE", "NODE_EXTRA_CA_CERTS"}
    env = {key: value for key, value in os.environ.items() if key.upper() in runtime_keys}
    for k, v in (secrets.get("env") or {}).items():
        env[str(k)] = str(v)
    return env


def _redact(value: object, secrets: JsonObject) -> object:
    if isinstance(value, dict):
        return {str(_redact(key, secrets)): _redact(child, secrets) for key, child in value.items()}
    if isinstance(value, list):
        return [_redact(child, secrets) for child in value]
    if not isinstance(value, str):
        return value
    for group in ("headers", "env", "oauth"):
        for secret in (secrets.get(group) or {}).values():
            if isinstance(secret, str) and secret:
                value = value.replace(secret, "<REDACTED>")
                if secret.lower().startswith("bearer ") and len(secret[7:]) >= 8:
                    value = value.replace(secret[7:], "<REDACTED>")
                if group == "oauth" and len(secret) >= 8:
                    value = value.replace(secret, "<REDACTED>")
    return value


def _http_headers(server: JsonObject, secrets: JsonObject, *, force_token: bool = False) -> dict[str, str]:
    """Cabeceras HTTP del servidor: secretos del usuario más bearer OAuth si aplica."""
    headers = {str(k): str(v) for k, v in (secrets.get("headers") or {}).items()}
    oauth = server.get("oauth") or {}
    token_url = oauth.get("token_url")
    client_id = oauth.get("client_id")
    if isinstance(token_url, str) and token_url and isinstance(client_id, str) and client_id:
        token = mcp_client.client_credentials_token(
            token_url,
            client_id,
            str((secrets.get("oauth") or {}).get("client_secret") or ""),
            [str(s) for s in oauth.get("scopes") or []],
            force=force_token,
        )
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _http_with_401_retry(server: JsonObject, secrets: JsonObject, call: Callable[[dict[str, str]], _T]) -> _T:
    """Ejecuta la llamada HTTP; si un token OAuth fue rechazado (401), lo renueva una única vez."""
    oauth = server.get("oauth") or {}
    try:
        return call(_http_headers(server, secrets))
    except mcp_client.McpError as err:
        if not (oauth.get("token_url") and oauth.get("client_id")) or "HTTP 401" not in str(err):
            raise
        mcp_client.clear_client_token(str(oauth["token_url"]), str(oauth["client_id"]))
        return call(_http_headers(server, secrets, force_token=True))


def approval_context(server_id: str, advertised_name: str, *, force: bool = True) -> JsonObject:
    server = get_server(server_id)
    try:
        tools = list_tools(server_id, force=force)
    except Exception:
        raise ValueError("No se pudo verificar la herramienta MCP; comprueba su conexión antes de aprobar") from None
    real_name = _resolve_tool_name(server_id, advertised_name, advertised=True)
    tool = next(t for t in tools if t["name"] == real_name)
    if not tool.get("enabled", True):
        raise ValueError("La herramienta MCP está deshabilitada; selecciónala en Conexiones")
    config = {k: server.get(k) for k in ("id", "transport", "url", "command", "args", "tool_revision")}
    canonical = json.dumps({"config": config, "tool": tool, "credentials": _secrets(server_id)},
                           sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return {"account": f"MCP: {server['name']}", "server_id": server_id, "tool": real_name,
            "tool_version": hashlib.sha256(canonical.encode("utf-8")).hexdigest()}


def list_tools(server_id: str, *, force: bool = False) -> list[JsonObject]:
    server = get_server(server_id)
    with _lock:
        cached = _tools_cache.get(server_id)
        if cached and not force and time.time() - cached[0] < _TOOLS_TTL_S:
            return [{**tool, "enabled": tool["name"] not in server.get("disabled_tools", [])} for tool in cached[1]]
    secrets = _secrets(server_id)
    try:
        if server["transport"] == "http":
            tools = _http_with_401_retry(
                server, secrets, lambda headers: mcp_client.list_tools_http(server["url"], headers),
            )
        else:
            tools = mcp_client.list_tools_stdio(server["command"], server.get("args") or [], _stdio_env(secrets))
    except Exception as err:
        with _lock:
            _tools_status[server_id] = {"status": "unavailable", "checked_at": int(time.time() * 1000),
                                        "error": str(_redact(str(err), secrets))[:400]}
        raise
    clean = []
    for tool in tools:
        t = _redact(tool, secrets)
        if not isinstance(t, dict) or not t.get("name") or t["name"] != tool.get("name"):
            continue
        clean.append({
            "name": str(t["name"]),
            "description": str(t.get("description") or "")[:300],
            "inputSchema": t.get("inputSchema") if isinstance(t.get("inputSchema"), dict) else {"type": "object", "properties": {}},
        })
    with _lock:
        _tools_cache[server_id] = (time.time(), clean)
        _tools_status[server_id] = {"status": "ready", "checked_at": int(time.time() * 1000), "tools_count": len(clean)}
        servers = _load()
        for s in servers:
            if s.get("id") == server_id:
                s["tools_count"] = len(clean)
        _save(servers)
    server = get_server(server_id)
    return [{**tool, "enabled": tool["name"] not in server.get("disabled_tools", [])} for tool in clean]


def server_statuses(*, refresh: bool = False) -> list[JsonObject]:
    result = []
    for server in _load():
        server_id = str(server["id"])
        if refresh:
            with contextlib.suppress(Exception):
                list_tools(server_id, force=True)
        with _lock:
            status = dict(_tools_status.get(server_id) or {"status": "unverified"})
        result.append({"id": server_id, "name": server["name"], **status})
    return result


def set_tool_enabled(server_id: str, tool: str, enabled: bool) -> JsonObject:
    tools = list_tools(server_id)
    if not any(item["name"] == tool for item in tools):
        raise ValueError("La herramienta MCP ya no está disponible; vuelve a listar el servidor")
    with _lock:
        servers = _load()
        server = next((s for s in servers if s["id"] == server_id), None)
        if server is None:
            raise ValueError("El servidor MCP se desconectó")
        disabled = set(server.get("disabled_tools") or [])
        if (tool not in disabled) != enabled:
            if enabled:
                disabled.discard(tool)
            else:
                disabled.add(tool)
            server["disabled_tools"] = sorted(disabled)
            server["tool_revision"] = int(server.get("tool_revision") or 0) + 1
            _save(servers)
    return {"name": tool, "enabled": enabled}


def call_tool(
    server_id: str, tool: str, args: JsonObject, *, advertised: bool = False,
    cancelled: Callable[[], bool] | None = None,
    approved_context: JsonObject | None = None,
) -> JsonObject:
    with _lock:
        if approved_context is not None and approval_context(server_id, tool, force=False) != approved_context:
            raise ValueError("La configuración MCP cambió después de aprobar; solicita una nueva aprobación")
        server = get_server(server_id)
        secrets = _secrets(server_id)
        tool = _resolve_tool_name(server_id, tool, advertised=advertised)
        if tool in server.get("disabled_tools", []):
            raise ValueError("La herramienta MCP está deshabilitada; selecciónala en Conexiones")
    try:
        if server["transport"] == "http":
            def _call(headers: dict[str, str]) -> JsonObject:
                return mcp_client.call_tool_http(
                    server["url"], headers, tool, args,
                    **({"cancelled": cancelled} if cancelled else {}),
                )

            result = _http_with_401_retry(server, secrets, _call)
        else:
            result = mcp_client.call_tool_stdio(
                server["command"], server.get("args") or [], _stdio_env(secrets), tool, args,
                **({"cancelled": cancelled} if cancelled else {}),
            )
    except mcp_client.McpCancelled:
        raise
    except mcp_client.McpUncertain as err:
        if advertised:
            raise mcp_client.McpUncertain(str(_redact(str(err), secrets))) from None
        raise
    except Exception as err:
        if advertised:
            raise ValueError(_redact(str(err), secrets)) from None
        raise
    if advertised:
        cleaned = _redact(result, secrets)
        if isinstance(cleaned, dict):
            result = cleaned
    return mcp_client.normalize_result(result)


def agent_tool_name(server_id: str, tool: str) -> str:
    """Nombre anunciado al LLM: un function name válido (<=64, [A-Za-z0-9_-])."""
    alias = f"{server_id[:19]}-{hashlib.sha256(server_id.encode()).hexdigest()[:12]}"
    prefix = f"mcp2__{alias}__"
    clean = _TOOL_NAME_RE.sub('-', tool)
    if tool:
        clean = f"{clean[:64 - len(prefix) - 13]}-{hashlib.sha256(tool.encode()).hexdigest()[:12]}"
    return prefix + clean


def _resolve_tool_name(server_id: str, name: str, *, advertised: bool = False) -> str:
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


def _mention_slug(text: str) -> str:
    folded = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().casefold()
    return re.sub(r"[\s_]+", "-", folded.strip())


def mentioned_servers(tokens: list[str]) -> list[JsonObject]:
    """Servidores mencionados con @nombre (espacios como guiones) o @id y sus herramientas habilitadas para el agente."""
    wanted = {_mention_slug(token): token for token in tokens}
    found: list[JsonObject] = []
    for server in list_servers():
        server_id = str(server["id"])
        token = wanted.get(_mention_slug(str(server["name"]))) or wanted.get(_mention_slug(server_id))
        if token is None:
            continue
        entry: JsonObject = {"mention": token, "name": str(server["name"]), "tools": [], "error": None}
        try:
            entry["tools"] = [agent_tool_name(server_id, str(tool["name"]))
                              for tool in list_tools(server_id) if tool.get("enabled", True)]
        except Exception:
            entry["error"] = "no responde; revisa su conexión en Conexiones"
        found.append(entry)
    return found


def parse_agent_tool(name: str) -> tuple[str, str] | None:
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
