
"""Cliente MCP (Model Context Protocol) mínimo para los servidores del agente.

Dos transportes:
- ``http``: Streamable HTTP — un POST JSON-RPC por llamada; si el servidor
  responde ``Mcp-Session-Id`` en ``initialize`` se reenvía en las llamadas
  siguientes de la misma sesión. Respuestas SSE se leen línea a línea.
- ``stdio``: proceso hijo con JSON-RPC delimitado por líneas en stdin/stdout;
  cada llamada abre una sesión efímera (initialize → initialized → call).

Límites: 1 MiB por respuesta, timeout acotado por transporte.
"""

from __future__ import annotations

import contextlib
import json
import queue
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable

from backend.core.integrations import http_guard
from backend.core.integrations.types import JsonObject

_PROTOCOL_VERSION = "2024-11-05"
_CLIENT_INFO = {"name": "antares", "version": "1.0"}
_MAX_RESPONSE_BYTES = 1024 * 1024
_HTTP_TIMEOUT_S = 30.0
_STDIO_TIMEOUT_S = 45.0
_MAX_TOOL_PAGES = 32
_MAX_TOOLS = 512
_TOKEN_TIMEOUT_S = 15.0
_TOKEN_EXPIRY_SKEW_S = 30
_TOKEN_CACHE: dict[tuple[str, str], tuple[float, str]] = {}


class McpError(ValueError):
    pass


class McpCancelled(McpError):
    pass


class McpUncertain(McpError):
    pass


def _tool_pages(request: Callable[[JsonObject], JsonObject]) -> JsonObject:
    tools: list[JsonObject] = []
    seen: set[str] = set()
    names: set[str] = set()
    params: JsonObject = {}
    for _ in range(_MAX_TOOL_PAGES):
        result = request(params)
        page = result.get("tools")
        if not isinstance(page, list):
            raise McpError("Catálogo MCP sin lista de herramientas")
        for tool in page:
            if not isinstance(tool, dict) or not isinstance(tool.get("name"), str) or not tool["name"]:
                raise McpError("Nombre de herramienta MCP inválido")
            if tool["name"] in names:
                raise McpError("El servidor MCP publicó nombres de herramientas duplicados")
            schema = tool.get("inputSchema")
            if schema is not None and (not isinstance(schema, dict) or schema.get("type") != "object"):
                raise McpError("Schema de herramienta MCP inválido")
            names.add(tool["name"])
            tools.append(tool)
            if len(tools) > _MAX_TOOLS:
                raise McpError("El catálogo MCP supera 512 herramientas")
        cursor = result.get("nextCursor")
        if cursor is None:
            return {"tools": tools}
        if not isinstance(cursor, str) or not cursor or cursor in seen:
            raise McpError("Cursor MCP inválido o repetido")
        seen.add(cursor)
        params = {"cursor": cursor}
    raise McpError("El catálogo MCP supera 32 páginas")


def _rpc(method: str, params: JsonObject | None = None, rpc_id: int = 1) -> JsonObject:
    return {
        "jsonrpc": "2.0",
        "id": rpc_id,
        "method": method,
        "params": params or {},
    }


def _init_message(rpc_id: int = 0) -> JsonObject:
    return _rpc(
        "initialize",
        {
            "protocolVersion": _PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": _CLIENT_INFO,
        },
        rpc_id,
    )


def _initialized_notification() -> JsonObject:
    return {"jsonrpc": "2.0", "method": "notifications/initialized"}


def _result_of(message: JsonObject) -> JsonObject:
    if message.get("error"):
        err = message["error"]
        raise McpError(f"Error MCP {err.get('code')}: {str(err.get('message'))[:300]}")
    result = message.get("result")
    if not isinstance(result, dict):
        raise McpError("Respuesta MCP sin result")
    return result


def _parse_sse_response(raw: bytes) -> JsonObject:
    text = raw.decode("utf-8", errors="replace").strip()
    if not text:
        raise McpError("Respuesta MCP vacía")
    if text.startswith("{"):
        last_data = text
    else:
        last_data = ""
        for line in text.splitlines():
            if line.startswith("data:"):
                last_data = line[5:].strip()
        if not last_data:
            raise McpError("Respuesta SSE sin datos JSON-RPC")
    data = json.loads(last_data)
    if not isinstance(data, dict):
        raise McpError("Respuesta MCP no es un objeto JSON")
    return data


def _http_post(url: str, headers: dict[str, str], payload: JsonObject) -> tuple[JsonObject, str | None]:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
            "User-Agent": "Antares/mcp",
            **headers,
        },
        method="POST",
    )
    try:
        with http_guard.no_redirect_opener.open(req, timeout=_HTTP_TIMEOUT_S) as res:
            raw = res.read(_MAX_RESPONSE_BYTES + 1)
            session_id = res.headers.get("Mcp-Session-Id") or res.headers.get("mcp-session-id")
            status = res.status
    except urllib.error.HTTPError as err:
        if 300 <= err.code < 400:
            raise McpError(
                f"El servidor MCP respondió HTTP {err.code} (redirección bloqueada); registra la URL final"
            ) from err
        detail = err.read(400).decode("utf-8", errors="replace")
        raise McpError(f"El servidor MCP respondió HTTP {err.code}: {detail[:200]}") from err
    except urllib.error.URLError as err:
        raise McpError(f"Sin respuesta del servidor MCP: {err.reason}") from err
    if len(raw) > _MAX_RESPONSE_BYTES:
        raise McpError("La respuesta del servidor MCP supera el tamaño máximo")
    if status == 202 and "id" not in payload and not raw:
        return {}, session_id
    return _parse_sse_response(raw), session_id


def _http_session_call(
    url: str, headers: dict[str, str], calls: list[tuple[str, JsonObject | None]],
    cancelled: Callable[[], bool] | None = None,
) -> list[JsonObject]:
    init_res, session_id = _http_post(url, headers, _init_message())
    init_result = _result_of(init_res)
    headers = {**headers, "MCP-Protocol-Version": str(init_result.get("protocolVersion") or _PROTOCOL_VERSION)}
    if session_id:
        headers = {**headers, "Mcp-Session-Id": session_id}
    _http_post(url, headers, _initialized_notification())
    results = []
    rpc_id = 0

    def request(method: str, params: JsonObject | None) -> JsonObject:
        nonlocal rpc_id
        rpc_id += 1
        current_id = rpc_id
        if cancelled and cancelled():
            raise McpCancelled("La operación MCP se canceló antes del envío")
        def call() -> JsonObject:
            try:
                res, _ = _http_post(url, headers, _rpc(method, params, rpc_id=current_id))
            except (McpError, OSError) as err:
                if method == "tools/call":
                    raise McpUncertain(str(err)) from err
                raise
            return _result_of(res)

        if cancelled is None:
            return call()
        box: queue.Queue[JsonObject | Exception] = queue.Queue(maxsize=1)

        def receive() -> None:
            try:
                box.put(call())
            except Exception as err:
                box.put(err)

        threading.Thread(target=receive, daemon=True, name="mcp-http-call").start()
        while True:
            try:
                value = box.get(timeout=0.1)
                if isinstance(value, Exception):
                    raise value
                return value
            except queue.Empty:
                if cancelled():
                    def notify() -> None:
                        with contextlib.suppress(Exception):
                            _http_post(url, headers, {"jsonrpc": "2.0", "method": "notifications/cancelled",
                                                     "params": {"requestId": current_id, "reason": "Cancelado por el usuario"}})
                    threading.Thread(target=notify, daemon=True, name="mcp-http-cancel").start()
                    raise McpCancelled("Cancelación enviada al servidor MCP; comprueba el efecto antes de repetir") from None

    for method, params in calls:
        results.append(_tool_pages(lambda page: request("tools/list", page)) if method == "tools/list" else request(method, params))
    return results


def list_tools_http(url: str, headers: dict[str, str]) -> list[JsonObject]:
    (result,) = _http_session_call(url, headers, [("tools/list", None)])
    tools = result.get("tools")
    return tools if isinstance(tools, list) else []


def call_tool_http(
    url: str, headers: dict[str, str], tool: str, args: JsonObject,
    *, cancelled: Callable[[], bool] | None = None,
) -> JsonObject:
    (result,) = _http_session_call(
        url,
        headers,
        [("tools/call", {"name": tool, "arguments": args})],
        cancelled,
    )
    return result


def _token_post(url: str, fields: dict[str, str]) -> JsonObject:
    req = urllib.request.Request(
        url,
        data=urllib.parse.urlencode(fields).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Antares/mcp",
        },
        method="POST",
    )
    try:
        with http_guard.no_redirect_opener.open(req, timeout=_TOKEN_TIMEOUT_S) as res:
            raw = res.read(_MAX_RESPONSE_BYTES)
    except urllib.error.HTTPError as err:
        detail = err.read(200).decode("utf-8", errors="replace")
        raise McpError(f"El endpoint de token respondió HTTP {err.code}: {detail[:160]}") from err
    except urllib.error.URLError as err:
        raise McpError(f"Sin respuesta del endpoint de token: {err.reason}") from err
    try:
        data: JsonObject = json.loads(raw.decode("utf-8", errors="replace"))
    except ValueError as err:
        raise McpError("El endpoint de token no devolvió JSON") from err
    if not isinstance(data, dict):
        raise McpError("El endpoint de token no devolvió un objeto JSON")
    return data


def client_credentials_token(
    token_url: str, client_id: str, client_secret: str = "", scopes: list[str] | None = None, *,
    force: bool = False,
) -> str:
    """Bearer token OAuth2 client_credentials (con caché) para servidores MCP HTTP."""
    key = (token_url, client_id)
    if not force:
        cached = _TOKEN_CACHE.get(key)
        if cached and cached[0] > time.time() + _TOKEN_EXPIRY_SKEW_S:
            return cached[1]
    fields: dict[str, str] = {"grant_type": "client_credentials", "client_id": client_id}
    if client_secret:
        fields["client_secret"] = client_secret
    if scopes:
        fields["scope"] = " ".join(scopes)
    data = _token_post(token_url, fields)
    token = data.get("access_token")
    if not isinstance(token, str) or not token:
        raise McpError("El endpoint de token no devolvió access_token")
    try:
        ttl = int(data.get("expires_in") or 3600)
    except (TypeError, ValueError):
        ttl = 3600
    _TOKEN_CACHE[key] = (time.time() + max(ttl, 0), token)
    return token


def clear_client_token(token_url: str, client_id: str) -> None:
    """Invalida el token en caché de un par token_url/client_id (p. ej. tras un 401)."""
    _TOKEN_CACHE.pop((token_url, client_id), None)


def _stdio_session(
    command: str, args: list[str], env: dict[str, str], calls: list[tuple[str, JsonObject | None]],
    cancelled: Callable[[], bool] | None = None,
) -> list[JsonObject]:
    proc = subprocess.Popen(
        [shutil.which(command, path=env.get("PATH")) or command, *args],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env=env,
        text=False,
        encoding=None,
    )
    out_queue: queue.Queue[JsonObject | Exception] = queue.Queue(maxsize=32)
    reader_errors: list[Exception] = []

    def reader() -> None:
        assert proc.stdout is not None
        try:
            while True:
                line = proc.stdout.readline(_MAX_RESPONSE_BYTES + 1)
                if not line:
                    out_queue.put_nowait(McpError("El servidor MCP cerró su salida"))
                    return
                if len(line) > _MAX_RESPONSE_BYTES:
                    raise McpError("La respuesta del servidor MCP supera el tamaño máximo")
                line = line.strip()
                if not line or not line.startswith(b"{"):
                    continue
                message = json.loads(line)
                if not isinstance(message, dict):
                    raise McpError("Respuesta MCP no es un objeto JSON")
                try:
                    out_queue.put_nowait(message)
                except queue.Full:
                    raise McpError("El servidor MCP excedió el límite de mensajes pendientes") from None
        except Exception as err:
            reader_errors.append(err)
            with contextlib.suppress(queue.Full):
                out_queue.put_nowait(err)

    thread = threading.Thread(target=reader, name="mcp-stdio-reader", daemon=True)
    thread.start()

    def send(payload: JsonObject) -> None:
        assert proc.stdin is not None
        proc.stdin.write((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))
        proc.stdin.flush()

    def recv(rpc_id: int) -> JsonObject:
        deadline = time.monotonic() + _STDIO_TIMEOUT_S
        try:
            while True:
                if cancelled and cancelled():
                    with contextlib.suppress(Exception):
                        send({"jsonrpc": "2.0", "method": "notifications/cancelled",
                              "params": {"requestId": rpc_id, "reason": "Cancelado por el usuario"}})
                    raise McpCancelled("El proceso MCP se detuvo; comprueba los efectos externos antes de repetir")
                if reader_errors:
                    raise McpError(f"Lector stdio MCP falló: {reader_errors[0]}")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise queue.Empty
                try:
                    msg = out_queue.get(timeout=min(remaining, 0.1) if cancelled else remaining)
                except queue.Empty:
                    continue
                if isinstance(msg, Exception):
                    raise McpError(f"Lector stdio MCP falló: {msg}")
                if msg.get("id") == rpc_id:
                    return msg
        except queue.Empty:
            raise McpError(f"El servidor MCP no respondió en {_STDIO_TIMEOUT_S:.0f}s") from None

    try:
        send(_init_message())
        _result_of(recv(0))
        send(_initialized_notification())
        results = []
        rpc_id = 0

        def request(method: str, params: JsonObject | None) -> JsonObject:
            nonlocal rpc_id
            rpc_id += 1
            try:
                send(_rpc(method, params, rpc_id=rpc_id))
                response = recv(rpc_id)
            except McpCancelled:
                raise
            except (McpError, OSError) as err:
                if method == "tools/call":
                    raise McpUncertain(str(err)) from err
                raise
            return _result_of(response)

        for method, params in calls:
            results.append(_tool_pages(lambda page: request("tools/list", page)) if method == "tools/list" else request(method, params))
        return results
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            proc.kill()
            proc.wait(timeout=3)
        thread.join(timeout=1)


def list_tools_stdio(command: str, args: list[str], env: dict[str, str]) -> list[JsonObject]:
    (result,) = _stdio_session(command, args, env, [("tools/list", None)])
    tools = result.get("tools")
    return tools if isinstance(tools, list) else []


def call_tool_stdio(
    command: str, args: list[str], env: dict[str, str], tool: str, tool_args: JsonObject,
    *, cancelled: Callable[[], bool] | None = None,
) -> JsonObject:
    (result,) = _stdio_session(
        command,
        args,
        env,
        [("tools/call", {"name": tool, "arguments": tool_args})],
        cancelled,
    )
    return result


def normalize_result(result: JsonObject) -> JsonObject:
    content = result.get("content")
    texts = [c.get("text", "") for c in content or [] if isinstance(c, dict) and c.get("type") == "text"]
    return {
        "content": content if isinstance(content, list) else [],
        "text": "\n".join(t for t in texts if t),
        "isError": bool(result.get("isError")),
        **({"structuredContent": result["structuredContent"]} if "structuredContent" in result else {}),
    }


__all__ = [
    "McpError",
    "call_tool_http",
    "call_tool_stdio",
    "list_tools_http",
    "list_tools_stdio",
    "normalize_result",
]
