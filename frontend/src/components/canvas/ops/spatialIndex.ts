
import type { CanvasLayer } from '../types';
import { layerBounds } from './layerBounds';

export type BBox = { x: number; y: number; w: number; h: number };

export interface SpatialIndex {
  query(rect: BBox): string[];
  hitTest(x: number, y: number): string[];
}

interface ItemNode {
  id: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  zOrder: number;
}

interface RTreeNode {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  children?: RTreeNode[];
  item?: ItemNode;
}

const MAX_LEAF_ENTRIES = 8;

function buildRTreeNode(items: ItemNode[]): RTreeNode | null {
  if (items.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const it of items) {
    if (it.minX < minX) minX = it.minX;
    if (it.minY < minY) minY = it.minY;
    if (it.maxX > maxX) maxX = it.maxX;
    if (it.maxY > maxY) maxY = it.maxY;
  }

  if (items.length === 1) {
    return {
      minX,
      minY,
      maxX,
      maxY,
      item: items[0],
    };
  }

  if (items.length <= MAX_LEAF_ENTRIES) {
    return {
      minX,
      minY,
      maxX,
      maxY,
      children: items.map((it) => ({
        minX: it.minX,
        minY: it.minY,
        maxX: it.maxX,
        maxY: it.maxY,
        item: it,
      })),
    };
  }

  const extentX = maxX - minX;
  const extentY = maxY - minY;

  const sorted = [...items];
  if (extentX > extentY) {
    sorted.sort((a, b) => (a.minX + a.maxX) - (b.minX + b.maxX));
  } else {
    sorted.sort((a, b) => (a.minY + a.maxY) - (b.minY + b.maxY));
  }

  const mid = Math.floor(sorted.length / 2);
  const left = buildRTreeNode(sorted.slice(0, mid));
  const right = buildRTreeNode(sorted.slice(mid));

  const children: RTreeNode[] = [];
  if (left) children.push(left);
  if (right) children.push(right);

  return {
    minX,
    minY,
    maxX,
    maxY,
    children,
  };
}

const spatialIndexCache = new WeakMap<CanvasLayer[], SpatialIndex>();

export function buildSpatialIndex(layers: CanvasLayer[]): SpatialIndex {
  const cached = spatialIndexCache.get(layers);
  if (cached) return cached;

  const items: ItemNode[] = [];

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    if (layer.type === 'frame' || layer.visible === false || layer.locked) continue;
    const box = layerBounds(layer);
    items.push({
      id: layer.id,
      minX: box.x,
      minY: box.y,
      maxX: box.x + box.w,
      maxY: box.y + box.h,
      zOrder: i,
    });
  }

  const root = buildRTreeNode(items);

  function query(rect: BBox): string[] {
    if (!root) return [];
    const qMinX = rect.x;
    const qMinY = rect.y;
    const qMaxX = rect.x + rect.w;
    const qMaxY = rect.y + rect.h;

    const matched: ItemNode[] = [];
    const seen = new Set<string>();

    function traverse(node: RTreeNode): void {
      if (node.minX >= qMaxX || node.maxX <= qMinX || node.minY >= qMaxY || node.maxY <= qMinY) {
        return;
      }

      if (node.item) {
        if (!seen.has(node.item.id)) {
          seen.add(node.item.id);
          matched.push(node.item);
        }
        return;
      }

      if (node.children) {
        for (let i = 0; i < node.children.length; i++) {
          traverse(node.children[i]!);
        }
      }
    }

    traverse(root);
    matched.sort((a, b) => a.zOrder - b.zOrder);
    return matched.map((m) => m.id);
  }

  function hitTest(x: number, y: number): string[] {
    if (!root) return [];

    const hits: ItemNode[] = [];

    function traverse(node: RTreeNode): void {
      if (x < node.minX || x > node.maxX || y < node.minY || y > node.maxY) {
        return;
      }

      if (node.item) {
        if (x >= node.item.minX && x <= node.item.maxX && y >= node.item.minY && y <= node.item.maxY) {
          hits.push(node.item);
        }
        return;
      }

      if (node.children) {
        for (let i = 0; i < node.children.length; i++) {
          traverse(node.children[i]!);
        }
      }
    }

    traverse(root);
    hits.sort((a, b) => b.zOrder - a.zOrder);
    return hits.map((h) => h.id);
  }

  const index = { query, hitTest };
  spatialIndexCache.set(layers, index);
  return index;
}
