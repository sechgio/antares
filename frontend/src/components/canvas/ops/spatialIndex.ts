/**
 * Lightweight spatial index (uniform grid) for fast layer hit-testing.
 * Replaces O(n) linear scans in marquee selection and pointer hit-tests
 * with O(1) cell lookup + small candidate set.
 *
 * Rebuilt per gesture frame from the current layers array (cheap for <200 layers).
 * For documents with hundreds of layers this avoids scanning all bounds per query.
 */

import type { CanvasLayer } from '../types';
import { layerBounds } from './layerBounds';

export type BBox = { x: number; y: number; w: number; h: number };

type Cell = string[]; // layer ids

export interface SpatialIndex {
  /** Query all layer ids whose cell overlaps the given rect. */
  query(rect: BBox): string[];
  /** Point hit-test: returns layer ids in the cell containing (x,y). */
  hitTest(x: number, y: number): string[];
}

/** Cell size in mm. 20mm balances granularity vs. overhead for A4 (210×297). */
const CELL_SIZE_MM = 20;

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

function rectsOverlap(a: BBox, b: BBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Build a spatial index from the given layers.
 * Only indexes transformable layers (non-frame, visible, unlocked).
 * `hitTest` returns candidates top-most first (higher document index wins).
 */
export function buildSpatialIndex(layers: CanvasLayer[]): SpatialIndex {
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
    // Top-most first (document array order = paint order).
    hits.sort((a, b) => (zOrder.get(b) ?? 0) - (zOrder.get(a) ?? 0));
    return hits;
  }

  return { query, hitTest };
}
