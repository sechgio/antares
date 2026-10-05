"""Modelo y validación del grafo de un flujo (WorkflowGraph).

El esquema canónico es ``shared/workflow-schema.json``; este módulo normaliza
las entradas (defaults de puertos y posiciones) y aplica las reglas
estructurales: ids únicos, exactamente un nodo trigger, aristas entre nodos
existentes y ausencia de ciclos.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from backend.core.flows.types import JsonObject
from backend.utils.paths import resource_path

logger = logging.getLogger(__name__)

IMPLEMENTED_NODE_KINDS = frozenset(
    {"trigger", "tool_call", "condition", "transform", "http_request", "agent", "switch", "mcp_call"}
)
RESERVED_NODE_KINDS = frozenset({"loop", "code"})
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
    frozenset(str(k) for k in _schema_kinds) if _schema_kinds else IMPLEMENTED_NODE_KINDS | RESERVED_NODE_KINDS
)


def _node_kind_names() -> frozenset[str]:
    return NODE_KINDS


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
    kinds = _node_kind_names()
    trigger_count = 0
    for node in nodes:
        node_id = node["id"]
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", node_id):
            raise ValueError(f"Id de nodo inválido: {node_id}")
        if node_id in seen:
            raise ValueError(f"Id de nodo duplicado: {node_id}")
        seen.add(node_id)
        if node["kind"] not in kinds:
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
                 {"main", "waiting"} if source["kind"] == "tool_call" else {"main"})
        if edge["from_port"] not in ports:
            raise ValueError(f"Puerto de salida inexistente: {edge['from_node']}.{edge['from_port']}")
        if target["kind"] == "trigger" or edge["to_port"] != "main":
            raise ValueError(f"Puerto de entrada inexistente: {edge['to_node']}.{edge['to_port']}")

    _assert_acyclic(nodes, edges)


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
