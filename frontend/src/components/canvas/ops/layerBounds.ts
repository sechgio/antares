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

/** Unrotated layer bounding box in page mm. */
export function layerBoundsMm(layer: CanvasLayer): RectMm {
  return {
    x: parseMm(layer.cssVars['--translate-x']),
    y: parseMm(layer.cssVars['--translate-y']),
    w: parseMm(layer.cssVars['--width'], 10),
    h: parseMm(layer.cssVars['--height'], 10),
  };
}

/** Rotated AABB of a layer with edges and center (transform-origin = center). */
export function layerBounds(
  layer: CanvasLayer,
): RectMm & { right: number; bottom: number; cx: number; cy: number } {
  const x = parseMm(layer.cssVars['--translate-x']);
  const y = parseMm(layer.cssVars['--translate-y']);
  const w = parseMm(layer.cssVars['--width'], 10);
  const h = parseMm(layer.cssVars['--height'], 10);
  const rotate = parseRotateDeg(layer);
  if (!rotate) {
    return { x, y, w, h, right: x + w, bottom: y + h, cx: x + w / 2, cy: y + h / 2 };
  }
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rad = (rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    { dx: -w / 2, dy: -h / 2 },
    { dx: w / 2, dy: -h / 2 },
    { dx: w / 2, dy: h / 2 },
    { dx: -w / 2, dy: h / 2 },
  ].map(({ dx, dy }) => ({ x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }));
  const minX = Math.min(...corners.map((c) => c.x));
  const maxX = Math.max(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const maxY = Math.max(...corners.map((c) => c.y));
  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
    right: maxX,
    bottom: maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

/** Unrotated local box with edges and center (used for resize mapping). */
export function layerLocalBounds(
  layer: CanvasLayer,
): RectMm & { right: number; bottom: number; cx: number; cy: number } {
  const { x, y, w, h } = layerBoundsMm(layer);
  return { x, y, w, h, right: x + w, bottom: y + h, cx: x + w / 2, cy: y + h / 2 };
}
