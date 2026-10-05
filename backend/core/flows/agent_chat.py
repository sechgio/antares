"""Cliente LLM y catálogo de herramientas del agente.

``tool_specs`` expone los métodos ``backend:*`` del catálogo IPC: los
``orchestratable`` (solo lectura) se ejecutan directo y el resto pasa por
tarjeta de aprobación. ``chat`` llama al proveedor configurado con la clave
del vault y traduce el historial persistido al wire de cada API.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
import uuid

from backend.core.flows import ai_providers, http_guard, mcp_servers
from backend.core.flows.types import JsonObject
from backend.core.ipc_catalog import ORCHESTRATABLE_METHODS, backend_methods, input_schema_for

MAX_MESSAGE_CHARS = 12_000
_MAX_TOOL_RESULT_CHARS = 6_000
_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
_CHAT_TIMEOUT_S = 120.0

# Métodos backend que el agente nunca debe invocar (ni siquiera con aprobación):
# vault/claves, el propio canal del agente y borrados destructivos.
_DENIED_PREFIXES = ("ai_provider_", "flows_connection_", "flows_path_", "agent_")
_DENIED_METHODS = frozenset({"db_clear", "mcp_server_add", "mcp_server_delete", "mcp_tool_call"})

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


def _post_json(url: str, headers: dict[str, str], payload: JsonObject) -> JsonObject:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Antares/agent",
            **headers,
        },
        method="POST",
    )
    try:
        with http_guard.no_redirect_opener.open(req, timeout=_CHAT_TIMEOUT_S) as res:
            raw = res.read(_MAX_RESPONSE_BYTES + 1)
        if len(raw) > _MAX_RESPONSE_BYTES:
            raise ValueError("La respuesta del proveedor supera el tamaño máximo permitido")
        data: JsonObject = json.loads(raw.decode("utf-8"))
        return data
    except urllib.error.HTTPError as err:
        raise ValueError(
            f"El proveedor respondió HTTP {err.code}. Revisa la dirección, la clave y el modelo configurados."
        ) from err
    except urllib.error.URLError as err:
        raise ValueError(f"Sin respuesta del proveedor: {err.reason}") from err


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
) -> JsonObject:
    payload: JsonObject = {
        "model": model,
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
    data = _post_json(url, headers, payload)
    choices = data.get("choices") if isinstance(data, dict) else None
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise ValueError("El proveedor no devolvió una respuesta válida de OpenAI Chat Completions")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise ValueError("El proveedor no devolvió una respuesta válida de OpenAI Chat Completions")
    calls = []
    for call in message.get("tool_calls") or []:
        fn = call.get("function") or {}
        try:
            params = json.loads(fn.get("arguments") or "{}")
        except (TypeError, json.JSONDecodeError):
            params = {}
        calls.append(
            {
                "id": str(call.get("id") or uuid.uuid4().hex[:8]),
                "name": str(fn.get("name") or ""),
                "params": params if isinstance(params, dict) else {},
            }
        )
    text = message.get("content")
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
) -> JsonObject:
    payload: JsonObject = {
        "model": model,
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
    data = _post_json(url, headers, payload)
    if not isinstance(data, dict) or not isinstance(data.get("content"), list):
        raise ValueError("El proveedor no devolvió una respuesta válida de Anthropic Messages")
    text_parts: list[str] = []
    calls: list[JsonObject] = []
    for block in data.get("content") or []:
        if block.get("type") == "text":
            text_parts.append(str(block.get("text") or ""))
        elif block.get("type") == "tool_use":
            params = block.get("input")
            calls.append(
                {
                    "id": str(block.get("id") or uuid.uuid4().hex[:8]),
                    "name": str(block.get("name") or ""),
                    "params": params if isinstance(params, dict) else {},
                }
            )
    return {"text": "".join(text_parts), "calls": calls}


def chat(
    provider: str,
    model: str,
    messages: list[JsonObject],
    with_tools: bool = True,
    system: str | None = None,
) -> JsonObject:
    """Un turno LLM; `messages` es el historial persistido en formato neutro.

    ``with_tools=False`` desactiva las herramientas (nodos Agente de flujos:
    una sola respuesta de texto, sin tool-calling interactivo).
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
        return _chat_openai(url, headers, model, messages, with_tools, system)
    if style == "anthropic_messages":
        return _chat_anthropic(url, headers, model, messages, with_tools, system)
    raise ValueError(f"Estilo de chat no soportado: {style}")
