"""Handlers IPC de servidores MCP (Flujos → Conexiones).

`mcp_tool_call` es interno: lo usan el runner y el agente, nunca el renderer
(marca ``internal`` del catálogo).
"""

from __future__ import annotations

from backend.core.exceptions import ValidationError
from backend.core.flows import mcp_servers
from backend.core.flows.types import JsonObject
from backend.handlers.common import validate_params, with_locale


@with_locale
def _servers_list(params: JsonObject) -> JsonObject:
    return {"servers": mcp_servers.list_servers()}


@with_locale
@validate_params("name", "transport")
def _server_add(params: JsonObject) -> JsonObject:
    secrets = params.get("secrets")
    try:
        return {
            "server": mcp_servers.add_server(
                str(params["name"]),
                str(params["transport"]),
                url=str(params.get("url") or ""),
                command=str(params.get("command") or ""),
                args=[str(a) for a in params.get("args") or []],
                secrets=secrets if isinstance(secrets, dict) else None,
            )
        }
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc


@with_locale
@validate_params("server")
def _server_delete(params: JsonObject) -> JsonObject:
    try:
        return mcp_servers.remove_server(str(params["server"]))
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc


@with_locale
@validate_params("server")
def _server_tools(params: JsonObject) -> JsonObject:
    try:
        return {"tools": mcp_servers.list_tools(str(params["server"]), force=True)}
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc


@with_locale
@validate_params("server", "tool")
def _tool_call(params: JsonObject) -> JsonObject:
    args = params.get("args")
    try:
        return mcp_servers.call_tool(
            str(params["server"]),
            str(params["tool"]),
            args if isinstance(args, dict) else {},
        )
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc


HANDLERS = {
    "mcp_servers_list": _servers_list,
    "mcp_server_add": _server_add,
    "mcp_server_delete": _server_delete,
    "mcp_server_tools": _server_tools,
    "mcp_tool_call": _tool_call,
}
