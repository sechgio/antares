"""Cliente MCP (Model Context Protocol) mínimo para los servidores de Flujos.

Dos transportes:
- ``http``: Streamable HTTP — un POST JSON-RPC por llamada; si el servidor
  responde ``Mcp-Session-Id`` en ``initialize`` se reenvía en las llamadas
  siguientes de la misma sesión. Respuestas SSE se leen línea a línea.
- ``stdio``: proceso hijo con JSON-RPC delimitado por líneas en stdin/stdout;
  cada llamada abre una sesión efímera (initialize → initialized → call).

Límites: 1 MiB por respuesta, timeout acotado por transporte.
"""

from __future__ import annotations

import json
import queue
import shutil
import subprocess
import threading
import urllib.error
import urllib.request

from backend.core.flows import http_guard
from backend.core.flows.types import JsonObject

_PROTOCOL_VERSION = "2024-11-05"
_CLIENT_INFO = {"name": "antares-flujos", "version": "1.0"}
_MAX_RESPONSE_BYTES = 1024 * 1024
_HTTP_TIMEOUT_S = 30.0
_STDIO_TIMEOUT_S = 45.0


class McpError(ValueError):
    """Error del servidor MCP o del transporte."""


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


# ---------------------------------------------------------------------------
# Streamable HTTP
# ---------------------------------------------------------------------------


def _parse_sse_response(raw: bytes) -> JsonObject:
    """Extrae el mensaje JSON-RPC de un cuerpo que puede ser JSON o SSE."""
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
    url: str, headers: dict[str, str], calls: list[tuple[str, JsonObject | None]]
) -> list[JsonObject]:
    """Handshake initialize + una lista de llamadas JSON-RPC en la misma sesión."""
    init_res, session_id = _http_post(url, headers, _init_message())
    init_result = _result_of(init_res)  # valida el handshake
    headers = {**headers, "MCP-Protocol-Version": str(init_result.get("protocolVersion") or _PROTOCOL_VERSION)}
    if session_id:
        headers = {**headers, "Mcp-Session-Id": session_id}
    _http_post(url, headers, _initialized_notification())
    results = []
    for i, (method, params) in enumerate(calls, start=1):
        res, _ = _http_post(url, headers, _rpc(method, params, rpc_id=i))
        results.append(_result_of(res))
    return results


def list_tools_http(url: str, headers: dict[str, str]) -> list[JsonObject]:
    (result,) = _http_session_call(url, headers, [("tools/list", None)])
    tools = result.get("tools")
    return tools if isinstance(tools, list) else []


def call_tool_http(url: str, headers: dict[str, str], tool: str, args: JsonObject) -> JsonObject:
    (result,) = _http_session_call(
        url,
        headers,
        [("tools/call", {"name": tool, "arguments": args})],
    )
    return result


# ---------------------------------------------------------------------------
# stdio
# ---------------------------------------------------------------------------


def _stdio_session(
    command: str, args: list[str], env: dict[str, str], calls: list[tuple[str, JsonObject | None]]
) -> list[JsonObject]:
    proc = subprocess.Popen(
        [shutil.which(command, path=env.get("PATH")) or command, *args],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env=env,
        text=True,
        encoding="utf-8",
        bufsize=1,
    )
    out_queue: queue.Queue[JsonObject | Exception] = queue.Queue()

    def reader() -> None:
        assert proc.stdout is not None
        try:
            for line in proc.stdout:
                line = line.strip()
                if not line or not line.startswith("{"):
                    continue  # logs del servidor por stdout no conformes
                out_queue.put(json.loads(line))
        except Exception as err:  # va a la cola para el llamador
            out_queue.put(err)

    thread = threading.Thread(target=reader, name="mcp-stdio-reader", daemon=True)
    thread.start()

    def send(payload: JsonObject) -> None:
        assert proc.stdin is not None
        proc.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
        proc.stdin.flush()

    def recv(rpc_id: int) -> JsonObject:
        try:
            while True:
                msg = out_queue.get(timeout=_STDIO_TIMEOUT_S)
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
        for i, (method, params) in enumerate(calls, start=1):
            send(_rpc(method, params, rpc_id=i))
            results.append(_result_of(recv(i)))
        return results
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            proc.kill()


def list_tools_stdio(command: str, args: list[str], env: dict[str, str]) -> list[JsonObject]:
    (result,) = _stdio_session(command, args, env, [("tools/list", None)])
    tools = result.get("tools")
    return tools if isinstance(tools, list) else []


def call_tool_stdio(command: str, args: list[str], env: dict[str, str], tool: str, tool_args: JsonObject) -> JsonObject:
    (result,) = _stdio_session(
        command,
        args,
        env,
        [("tools/call", {"name": tool, "arguments": tool_args})],
    )
    return result


def normalize_result(result: JsonObject) -> JsonObject:
    """Uniforma la salida de tools/call: {content:[...], text, isError}."""
    content = result.get("content")
    texts = [c.get("text", "") for c in content or [] if isinstance(c, dict) and c.get("type") == "text"]
    return {
        "content": content if isinstance(content, list) else [],
        "text": "\n".join(t for t in texts if t),
        "isError": bool(result.get("isError")),
    }


__all__ = [
    "McpError",
    "call_tool_http",
    "call_tool_stdio",
    "list_tools_http",
    "list_tools_stdio",
    "normalize_result",
]
