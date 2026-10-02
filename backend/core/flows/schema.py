"""Modelo y validación del grafo de un flujo (WorkflowGraph).

El esquema canónico es ``shared/workflow-schema.json``; este módulo normaliza
las entradas (defaults de puertos y posiciones) y aplica las reglas
estructurales: ids únicos, exactamente un nodo trigger, aristas entre nodos
existentes y ausencia de ciclos.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from backend.core.flows.types import JsonObject
from backend.utils.paths import resource_path

logger = logging.getLogger(__name__)

IMPLEMENTED_NODE_KINDS = frozenset({"trigger", "tool_call", "condition", "transform"})
RESERVED_NODE_KINDS = frozenset({"loop", "http_request", "agent", "code"})
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
        if node["kind"] == "tool_call":
            method = node["config"].get("method")
            if not isinstance(method, str) or not method:
                raise ValueError(f"El nodo {node_id} (tool_call) requiere config.method")

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
