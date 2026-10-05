import type { Edge, Node } from '@xyflow/react';

/** True si añadir una arista `from → to` cerraría un ciclo en el grafo. */
export function createsCycle(edges: Edge[], from: string, to: string): boolean {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.source) ?? [];
    list.push(e.target);
    adj.set(e.source, list);
  }
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === from) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of adj.get(cur) ?? []) stack.push(next);
  }
  return false;
}

/**
 * Posiciones por niveles (BFS desde los nodos sin entrada): cada profundidad
 * es una columna y las filas se centran verticalmente.
 */
export function layoutByDepth(nodes: Node[], edges: Edge[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (!nodes.length) return positions;
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const n of nodes) {
    incoming.set(n.id, 0);
    outgoing.set(n.id, []);
  }
  for (const e of edges) {
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
    const list = outgoing.get(e.source) ?? [];
    list.push(e.target);
    outgoing.set(e.source, list);
  }
  const depth = new Map<string, number>();
  const queue = nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0).map((n) => n.id);
  if (!queue.length) queue.push(nodes[0].id);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of outgoing.get(cur) ?? []) {
      const d = (depth.get(cur) ?? 0) + 1;
      if ((depth.get(next) ?? -1) < d) {
        depth.set(next, d);
        queue.push(next);
      }
    }
  }
  const levels = new Map<number, string[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    levels.set(d, [...(levels.get(d) ?? []), n.id]);
  }
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    const row = (levels.get(d) ?? []).indexOf(n.id);
    const count = (levels.get(d) ?? []).length;
    positions.set(n.id, { x: d * 260, y: row * 130 - (count - 1) * 65 });
  }
  return positions;
}
