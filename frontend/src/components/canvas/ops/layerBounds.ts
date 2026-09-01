/**
 * Layer bounding-box helpers (single source for the rotated/unrotated AABB
 * routines used across selection, ops, culling, and the spatial index).
 *
 * `layerBoundsMm` is the unrotated local box; `layerBounds` returns the
 * axis-aligned bounding box of the rotated box (transform-origin = center),
 * plus convenience edges (`right`/`bottom`) and center (`cx`/`cy`).
 */

import type { CanvasLayer } from '../types';
import { parseMm } from '../types';

export type RectMm = { x: number; y: number; w: number; h: number };

/** Parse a layer's `--rotate` cssVar into degrees (0 when unset/invalid). */
export function parseRotateDeg(layer: CanvasLayer): number {
  return parseFloat(layer.cssVars['--rotate'] || '0') || 0;
}

const layerBoundsMmCache = new WeakMap<CanvasLayer['cssVars'], RectMm>();
const layerBoundsCache = new WeakMap<CanvasLayer['cssVars'], RectMm & { right: number; bottom: number; cx: number; cy: number }>();

/** Unrotated layer bounding box in page mm. */
export function layerBoundsMm(layer: CanvasLayer): RectMm {
  const cached = layerBoundsMmCache.get(layer.cssVars);
  if (cached) return cached;
  const res: RectMm = {
    x: parseMm(layer.cssVars['--translate-x']),
    y: parseMm(layer.cssVars['--translate-y']),
    w: parseMm(layer.cssVars['--width'], 10),
    h: parseMm(layer.cssVars['--height'], 10),
  };
  layerBoundsMmCache.set(layer.cssVars, res);
  return res;
}

/** Rotated AABB of a layer with edges and center (transform-origin = center). */
export function layerBounds(
  layer: CanvasLayer,
): RectMm & { right: number; bottom: number; cx: number; cy: number } {
  const cached = layerBoundsCache.get(layer.cssVars);
  if (cached) return cached;

  const x = parseMm(layer.cssVars['--translate-x']);
  const y = parseMm(layer.cssVars['--translate-y']);
  const w = parseMm(layer.cssVars['--width'], 10);
  const h = parseMm(layer.cssVars['--height'], 10);
  const rotate = parseRotateDeg(layer);
  if (!rotate) {
    const res = { x, y, w, h, right: x + w, bottom: y + h, cx: x + w / 2, cy: y + h / 2 };
    layerBoundsCache.set(layer.cssVars, res);
    return res;
  }
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rad = (rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const halfW = w / 2;
  const halfH = h / 2;

  const x0 = cx - halfW * cos + halfH * sin;
  const y0 = cy - halfW * sin - halfH * cos;
  const x1 = cx + halfW * cos + halfH * sin;
  const y1 = cy + halfW * sin - halfH * cos;
  const x2 = cx + halfW * cos - halfH * sin;
  const y2 = cy + halfW * sin + halfH * cos;
  const x3 = cx - halfW * cos - halfH * sin;
  const y3 = cy - halfW * sin + halfH * cos;

  const minX = Math.min(x0, x1, x2, x3);
  const maxX = Math.max(x0, x1, x2, x3);
  const minY = Math.min(y0, y1, y2, y3);
  const maxY = Math.max(y0, y1, y2, y3);

  const res = {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
    right: maxX,
    bottom: maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
  layerBoundsCache.set(layer.cssVars, res);
  return res;
}

/** Unrotated local box with edges and center (used for resize mapping). */
export function layerLocalBounds(
  layer: CanvasLayer,
): RectMm & { right: number; bottom: number; cx: number; cy: number } {
  const { x, y, w, h } = layerBoundsMm(layer);
  return { x, y, w, h, right: x + w, bottom: y + h, cx: x + w / 2, cy: y + h / 2 };
}
