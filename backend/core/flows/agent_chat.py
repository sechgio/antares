"""Cliente LLM y catálogo de herramientas del agente.

``tool_specs`` expone los métodos ``backend:*`` del catálogo IPC: los
``orchestratable`` (solo lectura) se ejecutan directo y el resto pasa por
tarjeta de aprobación. ``chat`` llama al proveedor configurado con la clave
del vault y traduce el historial persistido al wire de cada API.
"""

from __future__ import annotations

import http.client
import json
import time
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable
from typing import Any

from backend.core.flows import ai_providers, http_guard, mcp_servers
from backend.core.flows.types import JsonObject
from backend.core.ipc_catalog import ORCHESTRATABLE_METHODS, backend_methods, input_schema_for

MAX_MESSAGE_CHARS = 12_000
_MAX_TOOL_RESULT_CHARS = 6_000
_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
_CHAT_TIMEOUT_S = 120.0
_RETRYABLE_HTTP = frozenset({429, 500, 502, 503, 529})
_RETRY_DELAYS_S = (1.0, 4.0)
_RETRY_AFTER_CAP_S = 15.0
_ERR_BODY_MAX_BYTES = 4_096
_ERR_MSG_MAX_CHARS = 300

# Métodos backend que el agente nunca debe invocar (ni siquiera con aprobación):
# vault/claves, el propio canal del agente y borrados destructivos.
_DENIED_PREFIXES = ("ai_provider_", "flows_connection_", "flows_path_", "agent_")
_DENIED_METHODS = frozenset({
    "db_clear", "mcp_server_add", "mcp_server_delete", "mcp_tool_call",
    "flows_approval_decide", "flows_approvals_list", "flows_effects_pending",
    "flows_effect_resolve", "flows_run_resume", "flows_events_list", "flows_webhook_info",
})

# Efectos que ``auto_approve`` nunca cubre: destructivos, control de procesos,
# exportaciones masivas y escritura de flujos (el modelo no puede otorgarse
# nuevas primitivas). Las tools MCP tampoco: son código de terceros.
_AUTO_APPROVE_DENIED_PARTS = ("delete", "clear", "reset", "cancel")
_AUTO_APPROVE_DENIED = frozenset({
    "db_export", "db_import", "formatos_upload", "process_start",
    "flows_create", "flows_update", "flows_duplicate", "flows_run",
})


def auto_approve_allowed(name: str) -> bool:
    """False si la herramienta siempre exige aprobación humana, aunque el nodo
    active ``auto_approve``."""
    if name.startswith(("mcp__", "mcp2__")):
        return False
    if name in _AUTO_APPROVE_DENIED:
        return False
    return not any(part in name for part in _AUTO_APPROVE_DENIED_PARTS)


# Claves cuyo valor nunca viaja al LLM: credenciales de nodos (webhook, headers
# HTTP), grants de archivos y cualquier campo con pinta de secreto.
_SECRET_RESULT_KEYS = frozenset({
    "secret", "headers", "api_key", "client_secret", "token", "access_token",
    "refresh_token", "authorization", "signature", "password",
    "_file_grants", "_flow_file_grants",
})


def scrub_secrets(value: Any) -> Any:
    """Copia recursiva sin credenciales ni grants para lo que viaja al LLM."""
    if isinstance(value, dict):
        return {
            key: ("…" if str(key).lower() in _SECRET_RESULT_KEYS else scrub_secrets(child))
            for key, child in value.items()
        }
    if isinstance(value, list):
        return [scrub_secrets(item) for item in value]
    return value

_SYSTEM_PROMPT = (
    "Eres el agente de Antares, una app de escritorio de documentos e imágenes. "
    "Responde en español. Tienes herramientas para consultar el estado de la app "
    "(métodos de solo lectura) y herramientas con efectos que el usuario aprueba "
    "una a una. Usa herramientas cuando la respuesta dependa de datos reales de la "
    "app; si una herramienta requiere aprobación explícale al usuario qué hará."
)


def gated_methods() -> list[str]:
    return sorted(
        m
        for m in backend_methods()
        if m not in ORCHESTRATABLE_METHODS and m not in _DENIED_METHODS and not m.startswith(_DENIED_PREFIXES)
    )


def tool_specs() -> list[JsonObject]:
    """Specs de herramientas para el modelo (formato neutro, se adapta al proveedor)."""
    specs: list[JsonObject] = [
        {
            "name": m,
            "description": f"Antares · {m} (solo lectura)",
            "gated": False,
            "inputSchema": input_schema_for(m),
        }
        for m in sorted(ORCHESTRATABLE_METHODS)
    ]
    specs += [
        {
            "name": m,
            "description": f"Antares · {m} (efecto: requiere aprobación del usuario)",
            "gated": True,
            "inputSchema": input_schema_for(m),
        }
        for m in gated_methods()
    ]
    for server in mcp_servers.list_servers():
        try:
            tools = mcp_servers.list_tools(str(server["id"]))
        except Exception:
            continue  # un servidor caído no bloquea el chat
        for tool in tools:
            specs.append(
                {
                    "name": mcp_servers.agent_tool_name(str(server["id"]), str(tool["name"])),
                    "description": f"MCP {server['name']} · {tool['name']} — {tool['description'] or 'requiere aprobación del usuario'}",
                    "gated": True,
                    "inputSchema": tool["inputSchema"],
                }
            )
    return specs


def _auth_headers(spec: JsonObject, config: JsonObject) -> dict[str, str]:
    auth = spec.get("auth") or {}
    headers: dict[str, str] = {str(k): str(v) for k, v in (auth.get("extra_headers") or {}).items()}
    if auth.get("type") == "api_key":
        api_key = config.get("api_key")
        if not isinstance(api_key, str) or not api_key:
            raise ValueError("El proveedor no tiene API key guardada")
        header = auth.get("header") or "Authorization"
        prefix = auth.get("prefix") if isinstance(auth.get("prefix"), str) else ""
        headers[str(header)] = f"{prefix}{api_key}"
    return headers


def _safe_error(message: str, headers: dict[str, str]) -> str:
    for name, value in headers.items():
        if name.lower() in {"authorization", "x-api-key"} and value:
            message = message.replace(value.removeprefix("Bearer "), "[clave oculta]")
    return message[:_ERR_MSG_MAX_CHARS]


def _provider_http_error(err: urllib.error.HTTPError, headers: dict[str, str]) -> str:
    detail = ""
    try:
        data = json.loads(err.read(_ERR_BODY_MAX_BYTES))
        err_obj = data.get("error") if isinstance(data, dict) else None
        msg = err_obj.get("message") if isinstance(err_obj, dict) else None
        if isinstance(msg, str) and msg.strip():
            detail = f": {_safe_error(msg.strip(), headers)}"
    except Exception:
        pass
    return (
        f"El proveedor respondió HTTP {err.code}{detail}"
        if detail
        else f"El proveedor respondió HTTP {err.code}. Revisa la dirección, la clave y el modelo configurados."
    )


def _retry_delay_s(err: urllib.error.HTTPError, attempt: int) -> float:
    retry_after = err.headers.get("Retry-After") if err.headers else None
    try:
        delay = float(retry_after) if retry_after else _RETRY_DELAYS_S[attempt]
    except (TypeError, ValueError):
        delay = _RETRY_DELAYS_S[attempt]
    return max(0.0, min(delay, _RETRY_AFTER_CAP_S))


def _stream_response(res: http.client.HTTPResponse, on_delta: Callable[[str], None] | None = None) -> JsonObject:
    """Acumula SSE de ambos protocolos; ``on_delta`` recibe el texto parcial
    acumulado para mostrar streaming, sin publicar herramientas parciales."""
    message: JsonObject = {"content": "", "tool_calls": []}
    calls: dict[int, JsonObject] = {}
    blocks: dict[int, JsonObject] = {}
    inputs: dict[int, str] = {}
    open_blocks: set[int] = set()
    lines: list[str] = []
    total = 0
    native = False
    started = False
    complete = False
    deadline = time.monotonic() + _CHAT_TIMEOUT_S
    while True:
        if time.monotonic() >= deadline:
            raise ValueError("El streaming del proveedor excedió el tiempo máximo")
        raw = res.readline(_MAX_RESPONSE_BYTES - total + 1)
        total += len(raw)
        if total > _MAX_RESPONSE_BYTES:
            raise ValueError("La respuesta del proveedor supera el tamaño máximo permitido")
        if not raw:
            break
        line = raw.decode("utf-8").rstrip("\r\n")
        if line.startswith("data:"):
            lines.append(line[5:].lstrip(" "))
        if line or not lines:
            continue
        event = "\n".join(lines)
        lines = []
        if event == "[DONE]":
            complete = True
            break
        data = json.loads(event)
        if not isinstance(data, dict):
            raise ValueError("El proveedor devolvió un evento de streaming inválido")
        if data.get("error") or data.get("type") == "error":
            error = data.get("error") or {}
            detail = error.get("message", "Error de streaming") if isinstance(error, dict) else str(error)
            raise ValueError(f"Error de streaming del proveedor: {detail}")
        if "choices" in data:
            for choice in data["choices"]:
                if choice.get("index", 0) != 0:
                    continue
                started = True
                delta = choice.get("delta") or {}
                message["content"] += delta.get("content") or ""
                if on_delta and delta.get("content"):
                    on_delta(message["content"])
                for part in delta.get("tool_calls") or []:
                    call = calls.setdefault(part["index"], {"id": "", "function": {"name": "", "arguments": ""}})
                    call["id"] += part.get("id") or ""
                    for key in ("name", "arguments"):
                        call["function"][key] += (part.get("function") or {}).get(key) or ""
        elif data.get("type") == "message_start":
            native = started = True
        elif data.get("type") == "message_stop":
            complete = True
            break
        elif data.get("type") == "content_block_start":
            blocks[data["index"]] = dict(data["content_block"])
            open_blocks.add(data["index"])
        elif data.get("type") == "content_block_delta":
            index = data["index"]
            delta = data["delta"]
            if delta.get("type") == "text_delta":
                blocks[index]["text"] += delta["text"]
                if on_delta:
                    on_delta("".join(str(b.get("text") or "") for _, b in sorted(blocks.items())))
            elif delta.get("type") == "input_json_delta":
                inputs[index] = inputs.get(index, "") + delta["partial_json"]
        elif data.get("type") == "content_block_stop":
            open_blocks.remove(data["index"])
            if data["index"] in inputs:
                blocks[data["index"]]["input"] = json.loads(inputs.pop(data["index"]))
    if not complete or not started or open_blocks:
        raise ValueError("El streaming del proveedor terminó sin una respuesta completa")
    if native:
        return {"content": [blocks[index] for index in sorted(blocks)]}
    message["tool_calls"] = [calls[index] for index in sorted(calls)]
    return {"choices": [{"message": message}]}


def _post_json(
    url: str, headers: dict[str, str], payload: JsonObject, on_delta: Callable[[str], None] | None = None
) -> JsonObject:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    for attempt in range(len(_RETRY_DELAYS_S) + 1):
        req = urllib.request.Request(
            url,
            data=body,
            headers={
                "Accept": "application/json, text/event-stream",
                "Content-Type": "application/json",
                "User-Agent": "Antares/agent",
                **headers,
            },
            method="POST",
        )
        try:
            with http_guard.no_redirect_opener.open(req, timeout=_CHAT_TIMEOUT_S) as res:
                if res.headers.get_content_type() == "text/event-stream":
                    return _stream_response(res, on_delta)
                raw = res.read(_MAX_RESPONSE_BYTES + 1)
            if len(raw) > _MAX_RESPONSE_BYTES:
                raise ValueError("La respuesta del proveedor supera el tamaño máximo permitido")
            data: JsonObject = json.loads(raw.decode("utf-8"))
            return data
        except urllib.error.HTTPError as err:
            if err.code in _RETRYABLE_HTTP and attempt < len(_RETRY_DELAYS_S):
                err.close()
                time.sleep(_retry_delay_s(err, attempt))
                continue
            raise ValueError(_provider_http_error(err, headers)) from None
        except urllib.error.URLError as err:
            raise ValueError(_safe_error(f"Sin respuesta del proveedor: {err.reason}", headers)) from None
        except (OSError, http.client.HTTPException) as err:
            raise ValueError(_safe_error(f"Conexión interrumpida con el proveedor: {err}", headers)) from None
        except (UnicodeError, json.JSONDecodeError, TypeError, AttributeError, KeyError, IndexError):
            raise ValueError("El proveedor devolvió una respuesta inválida") from None
        except ValueError as err:
            raise ValueError(_safe_error(str(err), headers)) from None
    raise ValueError("unreachable")


def _with_synthetic_results(messages: list[JsonObject]) -> list[JsonObject]:
    """Completa con tool_results sintéticos las calls quedadas sin respuesta.

    Si un turno se interrumpió tras persistir las tool_calls pero antes de sus
    resultados, el historial queda inválido: las APIs rechazan la request por
    calls sin result. Sintetizarlos aquí repara también sesiones antiguas sin
    tocar el historial persistido.
    """
    answered = {str(m.get("tool_use_id")) for m in messages if m.get("role") == "tool_result"}
    out: list[JsonObject] = []
    for msg in messages:
        out.append(msg)
        if msg.get("role") != "assistant":
            continue
        for call in msg.get("tool_calls") or []:
            call_id = str(call.get("id"))
            if call_id not in answered:
                out.append(
                    {
                        "role": "tool_result",
                        "tool_use_id": call_id,
                        "name": call.get("name"),
                        "content": '{"error": "turno interrumpido: sin resultado"}',
                    }
                )
    return out


def _openai_wire(messages: list[JsonObject], system: str | None) -> list[JsonObject]:
    """Historial persistido → formato OpenAI chat completions."""
    wire: list[JsonObject] = [{"role": "system", "content": system or _SYSTEM_PROMPT}]
    for msg in _with_synthetic_results(messages):
        role = msg.get("role")
        if role == "user":
            wire.append({"role": "user", "content": str(msg.get("content") or "")[:MAX_MESSAGE_CHARS]})
        elif role == "assistant":
            entry: JsonObject = {
                "role": "assistant",
                "content": str(msg.get("content") or "") or None,
            }
            calls = msg.get("tool_calls")
            if calls:
                entry["tool_calls"] = [
                    {
                        "id": str(c["id"]),
                        "type": "function",
                        "function": {
                            "name": str(c["name"]),
                            "arguments": json.dumps(c.get("params") or {}, ensure_ascii=False),
                        },
                    }
                    for c in calls
                ]
            wire.append(entry)
        elif role == "tool_result":
            wire.append(
                {
                    "role": "tool",
                    "tool_call_id": str(msg.get("tool_use_id") or ""),
                    "content": str(msg.get("content") or "")[:_MAX_TOOL_RESULT_CHARS],
                }
            )
    return wire


def _chat_openai(
    url: str,
    headers: dict[str, str],
    model: str,
    messages: list[JsonObject],
    with_tools: bool,
    system: str | None,
    on_delta: Callable[[str], None] | None = None,
) -> JsonObject:
    payload: JsonObject = {
        "model": model,
        "stream": True,
        "messages": _openai_wire(messages, system),
    }
    if with_tools:
        payload["tools"] = [
            {
                "type": "function",
                "function": {
                    "name": s["name"],
                    "description": s["description"],
                    "parameters": s["inputSchema"],
                },
            }
            for s in tool_specs()
        ]
        payload["tool_choice"] = "auto"
    data = _post_json(url, headers, payload, on_delta)
    choices = data.get("choices") if isinstance(data, dict) else None
    message = (
        choices[0].get("message")
        if isinstance(choices, list) and choices and isinstance(choices[0], dict)
        else None
    )
    if not isinstance(message, dict):
        raise ValueError("El proveedor no devolvió una respuesta válida de OpenAI Chat Completions")
    calls = []
    tool_calls = message.get("tool_calls") or []
    if not isinstance(tool_calls, list):
        raise ValueError("El proveedor no devolvió una respuesta válida de OpenAI Chat Completions")
    for call in tool_calls:
        if not isinstance(call, dict) or not isinstance(call.get("function"), dict):
            raise ValueError("El proveedor no devolvió una respuesta válida de OpenAI Chat Completions")
        fn = call["function"]
        try:
            params = json.loads(fn.get("arguments") or "{}")
        except (TypeError, json.JSONDecodeError):
            raise ValueError("El proveedor devolvió argumentos de herramienta inválidos") from None
        if not isinstance(params, dict):
            raise ValueError("El proveedor devolvió argumentos de herramienta inválidos")
        calls.append(
            {
                "id": str(call.get("id") or uuid.uuid4().hex[:8]),
                "name": str(fn.get("name") or ""),
                "params": params,
            }
        )
    text = message.get("content")
    if text is not None and not isinstance(text, str):
        raise ValueError("El proveedor no devolvió una respuesta válida de OpenAI Chat Completions")
    return {"text": text if isinstance(text, str) else "", "calls": calls}


def _anthropic_wire(messages: list[JsonObject]) -> list[JsonObject]:
    """Historial persistido → formato Anthropic Messages (bloques)."""
    wire: list[JsonObject] = []
    pending_results: list[JsonObject] = []
    for msg in _with_synthetic_results(messages):
        role = msg.get("role")
        if role == "tool_result":
            pending_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": str(msg.get("tool_use_id") or ""),
                    "content": str(msg.get("content") or "")[:_MAX_TOOL_RESULT_CHARS],
                }
            )
            continue
        if pending_results:
            wire.append({"role": "user", "content": pending_results})
            pending_results = []
        if role == "user":
            wire.append({"role": "user", "content": str(msg.get("content") or "")[:MAX_MESSAGE_CHARS]})
        elif role == "assistant":
            content: list[JsonObject] = []
            if msg.get("content"):
                content.append({"type": "text", "text": str(msg["content"])[:MAX_MESSAGE_CHARS]})
            for c in msg.get("tool_calls") or []:
                content.append(
                    {
                        "type": "tool_use",
                        "id": str(c["id"]),
                        "name": str(c["name"]),
                        "input": c.get("params") or {},
                    }
                )
            if content:
                wire.append({"role": "assistant", "content": content})
    if pending_results:
        wire.append({"role": "user", "content": pending_results})
    return wire


def _chat_anthropic(
    url: str,
    headers: dict[str, str],
    model: str,
    messages: list[JsonObject],
    with_tools: bool,
    system: str | None,
    on_delta: Callable[[str], None] | None = None,
) -> JsonObject:
    payload: JsonObject = {
        "model": model,
        "stream": True,
        "max_tokens": 2048,
        "system": system or _SYSTEM_PROMPT,
        "messages": _anthropic_wire(messages),
    }
    if with_tools:
        payload["tools"] = [
            {
                "name": s["name"],
                "description": s["description"],
                "input_schema": s["inputSchema"],
            }
            for s in tool_specs()
        ]
    data = _post_json(url, headers, payload, on_delta)
    if not isinstance(data, dict) or not isinstance(data.get("content"), list):
        raise ValueError("El proveedor no devolvió una respuesta válida de Anthropic Messages")
    text_parts: list[str] = []
    calls: list[JsonObject] = []
    for block in data.get("content") or []:
        if not isinstance(block, dict):
            raise ValueError("El proveedor no devolvió una respuesta válida de Anthropic Messages")
        if block.get("type") == "text":
            if not isinstance(block.get("text"), str):
                raise ValueError("El proveedor no devolvió una respuesta válida de Anthropic Messages")
            text_parts.append(block["text"])
        elif block.get("type") == "tool_use":
            params = block.get("input")
            if not isinstance(params, dict):
                raise ValueError("El proveedor devolvió argumentos de herramienta inválidos")
            calls.append(
                {
                    "id": str(block.get("id") or uuid.uuid4().hex[:8]),
                    "name": str(block.get("name") or ""),
                    "params": params,
                }
            )
    return {"text": "".join(text_parts), "calls": calls}


def chat(
    provider: str,
    model: str,
    messages: list[JsonObject],
    with_tools: bool = True,
    system: str | None = None,
    on_delta: Callable[[str], None] | None = None,
) -> JsonObject:
    """Un turno LLM; `messages` es el historial persistido en formato neutro.

    ``with_tools=False`` desactiva las herramientas (nodos Agente de flujos:
    una sola respuesta de texto, sin tool-calling interactivo).
    ``on_delta`` recibe el texto parcial acumulado cuando el proveedor hace
    streaming (opcional; el chat del agente lo usa para mostrar progreso).
    """
    spec = ai_providers.get_provider(provider)
    config = ai_providers.get_config(provider) or {}
    chat_spec = spec.get("chat") or {}
    style = chat_spec.get("style")
    path = chat_spec.get("path")
    if not isinstance(style, str) or not isinstance(path, str):
        raise ValueError(f"El proveedor {provider} no declara endpoint de chat")
    base = config.get("base_url") or spec.get("base_url")
    if not isinstance(base, str) or not base:
        raise ValueError(f"El proveedor {provider} no tiene base_url")
    url = ai_providers.endpoint_url(base, path)
    headers = _auth_headers(spec, config)
    if style == "openai_chat":
        return _chat_openai(url, headers, model, messages, with_tools, system, on_delta)
    if style == "anthropic_messages":
        return _chat_anthropic(url, headers, model, messages, with_tools, system, on_delta)
    raise ValueError(f"Estilo de chat no soportado: {style}")
