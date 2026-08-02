import type { CanvasLayer } from '../types';

export interface LayerTreeNode {
  layer: CanvasLayer;
  children: LayerTreeNode[];
}

export interface FlatLayerRow {
  layer: CanvasLayer;
  depth: number;
  hasChildren: boolean;
}

const CONTAINER_TYPES = new Set(['group', 'grid', 'frame', 'component']);

export function isLayerContainer(layer: CanvasLayer): boolean {
  return CONTAINER_TYPES.has(layer.type);
}

/** Expand ids to include all descendants linked via parentId.
 *  O(n) index + O(k + descendants) BFS — not O(n × depth). */
export function expandWithDescendants(layers: CanvasLayer[], ids: string[]): string[] {
  if (ids.length === 0) return [];
  const childrenByParent = new Map<string, string[]>();
  for (const layer of layers) {
    if (!layer.parentId) continue;
    const list = childrenByParent.get(layer.parentId);
    if (list) list.push(layer.id);
    else childrenByParent.set(layer.parentId, [layer.id]);
  }
  const idSet = new Set(ids);
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop()!;
    const kids = childrenByParent.get(id);
    if (!kids) continue;
    for (const kid of kids) {
      if (idSet.has(kid)) continue;
      idSet.add(kid);
      stack.push(kid);
    }
  }
  return [...idSet];
}

/** Ancestor chain from parent up to root (nearest parent first). */
export function ancestorIds(layers: CanvasLayer[], id: string): string[] {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const out: string[] = [];
  let current = byId.get(id);
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    out.push(current.parentId);
    current = byId.get(current.parentId);
  }
  return out;
}

export function childIdsOf(layers: CanvasLayer[], parentId: string): string[] {
  return layers.filter((l) => l.parentId === parentId).map((l) => l.id);
}

/**
 * Build a tree for Capas. Frame layers are omitted.
 * Sibling order is paint-top-first (reverse of document array order).
 */
export function buildLayerTree(layers: CanvasLayer[]): LayerTreeNode[] {
  const content = layers.filter((l) => l.type !== 'frame');
  const idSet = new Set(content.map((l) => l.id));
  const byParent = new Map<string | undefined, CanvasLayer[]>();

  for (const layer of content) {
    const key = layer.parentId && idSet.has(layer.parentId) ? layer.parentId : undefined;
    const list = byParent.get(key) ?? [];
    list.push(layer);
    byParent.set(key, list);
  }

  const build = (parentId: string | undefined): LayerTreeNode[] => {
    const kids = [...(byParent.get(parentId) ?? [])].reverse();
    return kids.map((layer) => ({
      layer,
      children: isLayerContainer(layer) ? build(layer.id) : [],
    }));
  };

  return build(undefined);
}

export function flattenLayerTree(nodes: LayerTreeNode[], expandedIds: Set<string>): FlatLayerRow[] {
  const rows: FlatLayerRow[] = [];
  const walk = (list: LayerTreeNode[], depth: number) => {
    for (const node of list) {
      const hasChildren = node.children.length > 0;
      rows.push({ layer: node.layer, depth, hasChildren });
      if (hasChildren && expandedIds.has(node.layer.id)) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(nodes, 0);
  return rows;
}
