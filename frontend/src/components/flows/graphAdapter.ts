import type { Connection, Edge, Node } from '@xyflow/react';
import type { FlowEdge, FlowNode, WorkflowGraph } from './types';
import { createsCycle } from './flowLayout';

export interface FlowNodeData extends Record<string, unknown> {
  flowNode: FlowNode;
  stepStatus?: 'running' | 'success' | 'error' | 'skipped' | 'cancelled';
}

// Aristas punteadas suaves, estilo agent-builder: puntos redondos sobre curvas bezier.
export const FLOW_EDGE_STYLE = {
  stroke: 'color-mix(in srgb, var(--text-secondary) 52%, transparent)',
  strokeWidth: 1.75,
  strokeDasharray: '0.1 5.5',
  strokeLinecap: 'round',
} as const;

export function graphToReactFlow(graph: WorkflowGraph): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const nodes: Node<FlowNodeData>[] = graph.nodes.map((n) => ({
    id: n.id,
    type: 'flowNode',
    position: { x: n.position.x, y: n.position.y },
    data: { flowNode: n },
  }));
  const edges: Edge[] = graph.edges.map((e) => ({
    id: edgeId(e),
    source: e.from_node,
    sourceHandle: e.from_port,
    target: e.to_node,
    targetHandle: e.to_port,
    style: { ...FLOW_EDGE_STYLE },
  }));
  return { nodes, edges };
}

export function edgeId(e: Pick<FlowEdge, 'from_node' | 'to_node' | 'from_port' | 'to_port'>): string {
  return `${e.from_node}:${e.from_port}->${e.to_node}:${e.to_port}`;
}

export function reactFlowToGraph(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  prev: WorkflowGraph,
): WorkflowGraph {
  const prevById = new Map(prev.nodes.map((n) => [n.id, n]));
  const outNodes: FlowNode[] = nodes.map((n) => {
    const prevNode = prevById.get(n.id);
    const flowNode = (n.data?.flowNode as FlowNode | undefined) ?? prevNode;
    return {
      id: n.id,
      kind: flowNode?.kind ?? 'transform',
      name: flowNode?.name ?? n.id,
      config: flowNode?.config ?? {},
      position: { x: n.position.x, y: n.position.y },
    };
  });
  const outEdges: FlowEdge[] = edges.map((e) => ({
    from_node: e.source,
    to_node: e.target,
    from_port: e.sourceHandle || 'main',
    to_port: e.targetHandle || 'main',
  }));
  return { nodes: outNodes, edges: outEdges };
}

// Una conexión es válida si no es auto-lazo, ambos extremos existen, el destino
// no es un trigger y no cierra un ciclo en `edges`.
export function edgeConnectionValid(
  conn: Connection | Edge,
  edges: Edge[],
  nodes: Node<FlowNodeData>[],
): boolean {
  if (!conn.source || !conn.target || conn.source === conn.target) return false;
  const targetNode = nodes.find((n) => n.id === conn.target);
  const sourceNode = nodes.find((n) => n.id === conn.source);
  if (!targetNode || !sourceNode) return false;
  if (targetNode.data.flowNode.kind === 'trigger') return false;
  return !createsCycle(edges, conn.source, conn.target);
}

// Lista de aristas tras recablear `oldEdge` hacia `conn`, o null si no es válida.
export function reconnectEdge(
  oldEdge: Edge,
  conn: Connection,
  edges: Edge[],
  nodes: Node<FlowNodeData>[],
): Edge[] | null {
  const remaining = edges.filter((e) => e.id !== oldEdge.id);
  if (!edgeConnectionValid(conn, remaining, nodes)) return null;
  const id = `${conn.source}:${conn.sourceHandle ?? 'main'}->${conn.target}:${conn.targetHandle ?? 'main'}`;
  if (remaining.some((e) => e.id === id)) return null;
  return [...remaining, { ...oldEdge, ...conn, id, style: { ...FLOW_EDGE_STYLE } }];
}

export function makeNodeId(kind: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  let i = 1;
  let candidate = `${kind}_${i}`;
  while (taken.has(candidate)) {
    i += 1;
    candidate = `${kind}_${i}`;
  }
  return candidate;
}
