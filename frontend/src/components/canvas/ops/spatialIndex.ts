
import type { CanvasLayer } from '../types';
import { layerBounds } from './layerBounds';

export type BBox = { x: number; y: number; w: number; h: number };

type Cell = string[];

export interface SpatialIndex {
  query(rect: BBox): string[];
  hitTest(x: number, y: number): string[];
}

const CELL_SIZE_MM = 20;

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

function rectsOverlap(a: BBox, b: BBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

const spatialIndexCache = new WeakMap<CanvasLayer[], SpatialIndex>();

export function buildSpatialIndex(layers: CanvasLayer[]): SpatialIndex {
  const cached = spatialIndexCache.get(layers);
  if (cached) return cached;

  const grid = new Map<string, Cell>();
  const bboxes = new Map<string, BBox>();
  const zOrder = new Map<string, number>();

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    if (layer.type === 'frame' || layer.visible === false || layer.locked) continue;
    const box = layerBounds(layer);
    bboxes.set(layer.id, { x: box.x, y: box.y, w: box.w, h: box.h });
    zOrder.set(layer.id, i);

    const minCx = Math.floor(box.x / CELL_SIZE_MM);
    const minCy = Math.floor(box.y / CELL_SIZE_MM);
    const maxCx = Math.floor((box.x + box.w) / CELL_SIZE_MM);
    const maxCy = Math.floor((box.y + box.h) / CELL_SIZE_MM);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = cellKey(cx, cy);
        let cell = grid.get(key);
        if (!cell) {
          cell = [];
          grid.set(key, cell);
        }
        cell.push(layer.id);
      }
    }
  }

  function query(rect: BBox): string[] {
    const minCx = Math.floor(rect.x / CELL_SIZE_MM);
    const minCy = Math.floor(rect.y / CELL_SIZE_MM);
    const maxCx = Math.floor((rect.x + rect.w) / CELL_SIZE_MM);
    const maxCy = Math.floor((rect.y + rect.h) / CELL_SIZE_MM);

    const seen = new Set<string>();
    const result: string[] = [];

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const cell = grid.get(cellKey(cx, cy));
        if (!cell) continue;
        for (const id of cell) {
          if (seen.has(id)) continue;
          seen.add(id);
          const box = bboxes.get(id);
          if (box && rectsOverlap(box, rect)) {
            result.push(id);
          }
        }
      }
    }
    return result;
  }

  function hitTest(x: number, y: number): string[] {
    const cx = Math.floor(x / CELL_SIZE_MM);
    const cy = Math.floor(y / CELL_SIZE_MM);
    const cell = grid.get(cellKey(cx, cy));
    if (!cell) return [];
    const hits: string[] = [];
    for (const id of cell) {
      const box = bboxes.get(id);
      if (box && x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
        hits.push(id);
      }
    }
    hits.sort((a, b) => (zOrder.get(b) ?? 0) - (zOrder.get(a) ?? 0));
    return hits;
  }

  const index = { query, hitTest };
  spatialIndexCache.set(layers, index);
  return index;
}
