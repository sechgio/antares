"""Modelo y validación del grafo de un flujo (WorkflowGraph).

El esquema canónico es ``shared/workflow-schema.json``; este módulo normaliza
las entradas (defaults de puertos y posiciones) y aplica las reglas
estructurales: ids únicos, exactamente un nodo trigger, aristas entre nodos
existentes y ausencia de ciclos.
"""

from __future__ import annotations

import json
import re
from typing import Any

from backend.core.flows.types import JsonObject
from backend.utils.paths import resource_path

IMPLEMENTED_NODE_KINDS = frozenset(
    {"trigger", "tool_call", "condition", "transform", "http_request", "agent", "switch", "mcp_call", "loop", "code"}
)
TRIGGER_KINDS = frozenset({"manual", "schedule", "app_event", "webhook"})

MAX_FLOW_NODES = 200
MAX_FLOW_EDGES = 500

_SCHEMA_PATH = resource_path("shared/workflow-schema.json")


def _load_schema() -> JsonObject:
    try:
        data: JsonObject = json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))
        return data
    except (OSError, json.JSONDecodeError):
        return {}


_SCHEMA = _load_schema()
_schema_kinds = _SCHEMA.get("nodeKinds", {}) if isinstance(_SCHEMA, dict) else {}
NODE_KINDS: frozenset[str] = (
    frozenset(str(k) for k in _schema_kinds) if _schema_kinds else IMPLEMENTED_NODE_KINDS
)


def normalize_graph(graph: Any) -> JsonObject:
    if not isinstance(graph, dict):
        raise ValueError("graph debe ser un objeto")
    nodes_in = graph.get("nodes")
    edges_in = graph.get("edges")
    if not isinstance(nodes_in, list):
        raise ValueError("graph.nodes debe ser una lista")
    if edges_in is None:
        edges_in = []
    if not isinstance(edges_in, list):
        raise ValueError("graph.edges debe ser una lista")
    if len(nodes_in) > MAX_FLOW_NODES:
        raise ValueError(f"Demasiados nodos (máx {MAX_FLOW_NODES})")
    if len(edges_in) > MAX_FLOW_EDGES:
        raise ValueError(f"Demasiadas aristas (máx {MAX_FLOW_EDGES})")

    nodes: list[JsonObject] = []
    for raw in nodes_in:
        if not isinstance(raw, dict):
            raise ValueError("Cada nodo debe ser un objeto")
        node_id = raw.get("id")
        kind = raw.get("kind")
        if not isinstance(node_id, str) or not node_id:
            raise ValueError("Cada nodo requiere un id")
        if not isinstance(kind, str) or not kind:
            raise ValueError(f"El nodo {node_id} requiere un kind")
        config = raw.get("config")
        if config is None:
            config = {}
        if not isinstance(config, dict):
            raise ValueError(f"config del nodo {node_id} debe ser un objeto")
        position = raw.get("position")
        if not isinstance(position, dict):
            position = {"x": 0.0, "y": 0.0}
        name = raw.get("name")
        nodes.append(
            {
                "id": node_id,
                "kind": kind,
                "name": str(name) if isinstance(name, str) and name else node_id,
                "config": config,
                "position": {
                    "x": float(position.get("x") or 0),
                    "y": float(position.get("y") or 0),
                },
            }
        )

    edges: list[JsonObject] = []
    for raw in edges_in:
        if not isinstance(raw, dict):
            raise ValueError("Cada arista debe ser un objeto")
        from_node = raw.get("from_node")
        to_node = raw.get("to_node")
        if not isinstance(from_node, str) or not isinstance(to_node, str):
            raise ValueError("Cada arista requiere from_node y to_node")
        edges.append(
            {
                "from_node": from_node,
                "to_node": to_node,
                "from_port": str(raw.get("from_port") or "main"),
                "to_port": str(raw.get("to_port") or "main"),
            }
        )

    return {"nodes": nodes, "edges": edges}


def validate_graph(graph: JsonObject) -> None:
    """Valida la estructura del grafo normalizado. Lanza ValueError."""
    nodes = graph["nodes"]
    edges = graph["edges"]

    seen: set[str] = set()
    trigger_count = 0
    for node in nodes:
        node_id = node["id"]
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", node_id):
            raise ValueError(f"Id de nodo inválido: {node_id}")
        if node_id in seen:
            raise ValueError(f"Id de nodo duplicado: {node_id}")
        seen.add(node_id)
        if node["kind"] not in NODE_KINDS:
            raise ValueError(f"Tipo de nodo desconocido: {node['kind']} ({node_id})")
        if node["kind"] == "trigger":
            trigger_count += 1
            trigger_kind = node["config"].get("trigger_kind", "manual")
            if trigger_kind not in TRIGGER_KINDS:
                raise ValueError(f"trigger_kind inválido en {node_id}: {trigger_kind}")
            if trigger_kind == "schedule":
                interval = node["config"].get("interval_minutes", 60)
                if not isinstance(interval, int) or isinstance(interval, bool):
                    raise ValueError(f"interval_minutes del trigger {node_id} debe ser un entero de minutos")
                if interval < 1 or interval > 10080:
                    raise ValueError(f"interval_minutes del trigger {node_id} fuera de rango (1-10080)")
            if trigger_kind == "app_event":
                event = node["config"].get("event")
                if event is not None and (not isinstance(event, str) or not re.fullmatch(r"[a-z0-9_.-]{1,64}", event)):
                    raise ValueError(f"event del trigger {node_id} debe ser un nombre como 'job_finished' (o vacío para todos)")
            if trigger_kind == "webhook":
                suffix = node["config"].get("path")
                if suffix is not None and (not isinstance(suffix, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{0,64}", suffix)):
                    raise ValueError(f"path del webhook {node_id} solo admite letras, dígitos, '_' y '-'")
                secret = node["config"].get("secret")
                if not isinstance(secret, str) or not secret.strip() or len(secret) > 128:
                    raise ValueError(f"El webhook {node_id} requiere una clave secreta de hasta 128 caracteres")
        if node["kind"] == "tool_call":
            if node["config"].get("input_mode", "all") not in ("all", "any"):
                raise ValueError(f"input_mode inválido en {node_id}")
            method = node["config"].get("method")
            if not isinstance(method, str) or not method:
                raise ValueError(f"El nodo {node_id} (tool_call) requiere config.method")
            required = node["config"].get("required_args", [])
            if not isinstance(required, list) or any(not isinstance(key, str) or not key for key in required):
                raise ValueError(f"required_args del nodo {node_id} debe ser una lista de campos")
        if node["kind"] == "http_request":
            if not isinstance(node["config"].get("fail_on_http_error", True), bool):
                raise ValueError(f"fail_on_http_error debe ser booleano en {node_id}")
            url = node["config"].get("url")
            if not isinstance(url, str) or not url.strip():
                raise ValueError(f"El nodo {node_id} (http_request) requiere config.url")
            connection_ref = node["config"].get("connection_ref")
            if connection_ref is not None and (not isinstance(connection_ref, str) or not connection_ref.strip()):
                raise ValueError(f"connection_ref del nodo {node_id} debe ser un id de proveedor")
        if node["kind"] == "agent":
            # El proveedor se valida en ejecución (como connection_ref): puede
            # guardarse pendiente de configurar uno en Proveedores IA.
            prompt = node["config"].get("prompt")
            if not isinstance(prompt, str) or not prompt.strip():
                raise ValueError(f"El nodo {node_id} (agent) requiere config.prompt")
            tools = node["config"].get("tools", False)
            tools_ok = isinstance(tools, bool) or (
                isinstance(tools, list) and all(isinstance(name, str) and name for name in tools)
            )
            if not tools_ok:
                raise ValueError(f"tools del nodo {node_id} debe ser true/false o una lista de métodos")
            max_steps = node["config"].get("max_steps", 8)
            if not isinstance(max_steps, int) or isinstance(max_steps, bool) or not 1 <= max_steps <= 12:
                raise ValueError(f"max_steps del nodo {node_id} fuera de rango (1-12)")
            if not isinstance(node["config"].get("auto_approve", False), bool):
                raise ValueError(f"auto_approve del nodo {node_id} debe ser true o false")
        if node["kind"] == "loop":
            over = node["config"].get("over")
            if over is not None and not isinstance(over, str):
                raise ValueError(f"over del nodo {node_id} debe ser una expresión como '=item.json.filas'")
            max_items = node["config"].get("max_items", 100)
            if not isinstance(max_items, int) or isinstance(max_items, bool) or not 1 <= max_items <= 1000:
                raise ValueError(f"max_items del nodo {node_id} fuera de rango (1-1000)")
        if node["kind"] == "code":
            code = node["config"].get("code")
            if not isinstance(code, str) or not code.strip():
                raise ValueError(f"El nodo {node_id} (code) requiere config.code")
            timeout_s = node["config"].get("timeout_s", 30)
            if not isinstance(timeout_s, (int, float)) or isinstance(timeout_s, bool) or not 1 <= timeout_s <= 120:
                raise ValueError(f"timeout_s del nodo {node_id} fuera de rango (1-120)")
            if not isinstance(node["config"].get("auto_approve", False), bool):
                raise ValueError(f"auto_approve del nodo {node_id} debe ser true o false")
        if node["kind"] == "mcp_call":
            server = node["config"].get("server")
            if not isinstance(server, str) or not server.strip():
                raise ValueError(f"El nodo {node_id} (mcp_call) requiere config.server")
            tool = node["config"].get("tool")
            if not isinstance(tool, str) or not tool.strip():
                raise ValueError(f"El nodo {node_id} (mcp_call) requiere config.tool")
        if node["kind"] == "switch":
            field = node["config"].get("field")
            if not isinstance(field, str) or not field.strip():
                raise ValueError(f"El nodo {node_id} (switch) requiere config.field")
            cases = node["config"].get("cases") or []
            if not isinstance(cases, list):
                raise ValueError(f"cases del nodo {node_id} debe ser una lista")
            seen_ports: set[str] = set()
            for case in cases:
                if not isinstance(case, dict):
                    raise ValueError(f"Cada caso del switch {node_id} debe ser un objeto")
                port = case.get("port")
                if not isinstance(port, str) or not port.strip():
                    raise ValueError(f"Cada caso del switch {node_id} requiere un port")
                if port in seen_ports or port == "default":
                    raise ValueError(f"Puerto de switch duplicado o reservado: {port}")
                seen_ports.add(port)
        retry = node["config"].get("retry")
        if retry is not None:
            if not isinstance(retry, dict):
                raise ValueError(f"retry del nodo {node_id} debe ser un objeto")
            attempts = retry.get("attempts", 1)
            delay = retry.get("delay_ms", 0)
            if not isinstance(attempts, int) or isinstance(attempts, bool) or attempts < 1 or attempts > 5:
                raise ValueError(f"retry.attempts del nodo {node_id} fuera de rango (1-5)")
            if not isinstance(delay, (int, float)) or isinstance(delay, bool) or delay < 0 or delay > 60000:
                raise ValueError(f"retry.delay_ms del nodo {node_id} fuera de rango (0-60000)")

    if trigger_count == 0:
        raise ValueError("El flujo requiere exactamente un nodo trigger")
    if trigger_count > 1:
        raise ValueError("El flujo solo puede tener un nodo trigger")

    for edge in edges:
        if edge["from_node"] not in seen:
            raise ValueError(f"Arista con origen inexistente: {edge['from_node']}")
        if edge["to_node"] not in seen:
            raise ValueError(f"Arista con destino inexistente: {edge['to_node']}")
        if edge["from_node"] == edge["to_node"]:
            raise ValueError(f"Arista de un nodo a sí mismo: {edge['from_node']}")
        source = next(node for node in nodes if node["id"] == edge["from_node"])
        target = next(node for node in nodes if node["id"] == edge["to_node"])
        ports = ({"true", "false"} if source["kind"] == "condition" else
                 {"default", *(case["port"] for case in source["config"].get("cases") or [])} if source["kind"] == "switch" else
                 {"main", "waiting"} if source["kind"] == "tool_call" else
                 {"each", "done"} if source["kind"] == "loop" else {"main"})
        if edge["from_port"] not in ports:
            raise ValueError(f"Puerto de salida inexistente: {edge['from_node']}.{edge['from_port']}")
        if target["kind"] == "trigger" or edge["to_port"] != "main":
            raise ValueError(f"Puerto de entrada inexistente: {edge['to_node']}.{edge['to_port']}")

    _assert_acyclic(nodes, edges)
    _assert_loop_regions(nodes, edges)


def _descendants(edges: list[JsonObject], roots: set[str]) -> set[str]:
    outgoing: dict[str, list[str]] = {}
    for edge in edges:
        outgoing.setdefault(edge["from_node"], []).append(edge["to_node"])
    seen: set[str] = set()
    queue = list(roots)
    while queue:
        nid = queue.pop()
        if nid in seen:
            continue
        seen.add(nid)
        queue.extend(outgoing.get(nid) or [])
    return seen


def _ancestors(edges: list[JsonObject], node_id: str) -> set[str]:
    incoming: dict[str, list[str]] = {}
    for edge in edges:
        incoming.setdefault(edge["to_node"], []).append(edge["from_node"])
    seen: set[str] = set()
    queue = [node_id]
    while queue:
        nid = queue.pop()
        for source in incoming.get(nid) or []:
            if source not in seen:
                seen.add(source)
                queue.append(source)
    return seen


def loop_body_regions(graph: JsonObject) -> dict[str, set[str]]:
    """Nodos del cuerpo de cada bucle: descendientes del puerto ``each`` que no
    son descendientes del puerto ``done`` (estos últimos reciben el resumen)."""
    edges = graph["edges"]
    regions: dict[str, set[str]] = {}
    for node in graph["nodes"]:
        if node["kind"] != "loop":
            continue
        each_targets = {e["to_node"] for e in edges if e["from_node"] == node["id"] and e["from_port"] == "each"}
        done_targets = {e["to_node"] for e in edges if e["from_node"] == node["id"] and e["from_port"] == "done"}
        regions[node["id"]] = _descendants(edges, each_targets) - _descendants(edges, done_targets) - {node["id"]}
    return regions


def _assert_loop_regions(nodes: list[JsonObject], edges: list[JsonObject]) -> None:
    kinds = {node["id"]: node["kind"] for node in nodes}
    for loop_id, body in loop_body_regions({"nodes": nodes, "edges": edges}).items():
        if not body:
            continue
        if any(kinds[nid] == "loop" for nid in body):
            raise ValueError(f"El bucle {loop_id} no puede contener otro bucle")
        ancestors = _ancestors(edges, loop_id)
        for edge in edges:
            in_body = edge["to_node"] in body
            from_body = edge["from_node"] in body
            if in_body and not from_body and edge["from_node"] != loop_id and edge["from_node"] not in ancestors:
                raise ValueError(
                    f"El nodo del bucle {edge['to_node']} depende de {edge['from_node']}, que no antecede al bucle"
                )
            if in_body and edge["from_node"] == loop_id and edge["from_port"] != "each":
                raise ValueError(f"Los nodos del bucle {loop_id} solo reciben datos del puerto 'each'")
            if from_body and not in_body and edge["to_node"] != loop_id:
                raise ValueError(
                    f"El nodo {edge['from_node']} está dentro del bucle {loop_id}; usa el puerto 'done' para recoger resultados"
                )


def _assert_acyclic(nodes: list[JsonObject], edges: list[JsonObject]) -> None:
    indegree = {node["id"]: 0 for node in nodes}
    outgoing: dict[str, list[str]] = {node["id"]: [] for node in nodes}
    for edge in edges:
        indegree[edge["to_node"]] += 1
        outgoing[edge["from_node"]].append(edge["to_node"])

    queue = [nid for nid, deg in indegree.items() if deg == 0]
    visited = 0
    while queue:
        nid = queue.pop()
        visited += 1
        for target in outgoing[nid]:
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
    if visited != len(nodes):
        raise ValueError("El flujo contiene un ciclo")
