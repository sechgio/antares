
import type { CanvasLayer, LayerPath } from '../types';
import { parseMm } from '../types';
import {
  applyPathToLayer,
  bendSegment,
  closestSegmentIndex,
  ensureLinePath,
  movePathHandle,
  movePathPoint,
  normalizePathOrigin,
  splitLineLayer,
  togglePathClosed,
} from './pathGeometry';

export const BEND_HIT_MM = 20;
export const CUT_HIT_MM = 8;

function lineOrigin(layer: CanvasLayer): { ensured: CanvasLayer; path: LayerPath; ox: number; oy: number } | null {
  const ensured = ensureLinePath(layer);
  const path = ensured.meta?.path;
  if (!path?.points?.length) return null;
  return {
    ensured,
    path,
    ox: parseMm(ensured.cssVars['--translate-x']),
    oy: parseMm(ensured.cssVars['--translate-y']),
  };
}

export function updateLinePath(layer: CanvasLayer, nextPath: LayerPath): CanvasLayer {
  const ctx = lineOrigin(layer);
  if (!ctx) return layer;
  const norm = normalizePathOrigin(nextPath);
  return applyPathToLayer(ctx.ensured, norm.path, ctx.ox + norm.dx, ctx.oy + norm.dy);
}

export function dragLineAnchor(
  layer: CanvasLayer,
  pointIndex: number,
  pageX: number,
  pageY: number,
): CanvasLayer {
  const ctx = lineOrigin(layer);
  if (!ctx) return layer;
  return updateLinePath(ctx.ensured, movePathPoint(ctx.path, pointIndex, pageX - ctx.ox, pageY - ctx.oy));
}

export function dragLineHandle(
  layer: CanvasLayer,
  pointIndex: number,
  which: 'hin' | 'hout',
  pageX: number,
  pageY: number,
  mirror = true,
): CanvasLayer {
  const ctx = lineOrigin(layer);
  if (!ctx) return layer;
  return updateLinePath(
    ctx.ensured,
    movePathHandle(ctx.path, pointIndex, which, pageX - ctx.ox, pageY - ctx.oy, mirror),
  );
}

export function bendLineAt(layer: CanvasLayer, pageX: number, pageY: number): CanvasLayer {
  const ctx = lineOrigin(layer);
  if (!ctx) return layer;
  const localX = pageX - ctx.ox;
  const localY = pageY - ctx.oy;
  const hit = closestSegmentIndex(ctx.path, localX, localY);
  if (hit.dist > BEND_HIT_MM) return layer;
  return updateLinePath(ctx.ensured, bendSegment(ctx.path, hit.index, localX, localY));
}

export function cutLineAt(
  layer: CanvasLayer,
  pageX: number,
  pageY: number,
): [CanvasLayer, CanvasLayer] | null {
  const ctx = lineOrigin(layer);
  if (!ctx) return null;
  const hit = closestSegmentIndex(ctx.path, pageX - ctx.ox, pageY - ctx.oy);
  if (hit.dist > CUT_HIT_MM) return null;
  return splitLineLayer(ctx.ensured, hit.index, hit.t);
}

export function toggleLineClosed(layer: CanvasLayer): CanvasLayer {
  const ctx = lineOrigin(layer);
  if (!ctx) return layer;
  return updateLinePath(ctx.ensured, togglePathClosed(ctx.path));
}
