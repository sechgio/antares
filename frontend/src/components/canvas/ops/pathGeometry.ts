
import type { CanvasLayer, LayerPath, PathPoint } from '../types';
import { mm, newId, parseMm } from '../types';
import { lineStrokeWidthPx, pxToMm } from './layerStyle';

const MIN_BBOX_MM = 0.5;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseStrokeCap(raw: string | undefined): 'none' | 'round' | 'square' | 'arrow' {
  if (raw === 'round' || raw === 'square' || raw === 'arrow') return raw;
  return 'none';
}

export function linePathFromLegacy(layer: Pick<CanvasLayer, 'cssVars' | 'type'>): LayerPath {
  const w = Math.max(MIN_BBOX_MM, parseMm(layer.cssVars['--width'], 80));
  const strokeMm = Math.max(0.05, pxToMm(lineStrokeWidthPx(layer as CanvasLayer)));
  const h = Math.max(strokeMm, parseMm(layer.cssVars['--height'], strokeMm));
  const y = round2(h / 2);
  return {
    points: [
      { x: 0, y },
      { x: round2(w), y },
    ],
    closed: false,
  };
}

export function pathFromDrag(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { path: LayerPath; originX: number; originY: number; width: number; height: number } {
  const minX = Math.min(x0, x1);
  const minY = Math.min(y0, y1);
  const maxX = Math.max(x0, x1);
  const maxY = Math.max(y0, y1);
  const width = Math.max(MIN_BBOX_MM, maxX - minX);
  const height = Math.max(MIN_BBOX_MM, maxY - minY);
  const path: LayerPath = {
    points: [
      { x: round2(x0 - minX), y: round2(y0 - minY) },
      { x: round2(x1 - minX), y: round2(y1 - minY) },
    ],
    closed: false,
  };
  return { path, originX: round2(minX), originY: round2(minY), width: round2(width), height: round2(height) };
}

function sampleHandles(p: PathPoint): { hin: { x: number; y: number }; hout: { x: number; y: number } } {
  return {
    hin: p.hin ?? { x: p.x, y: p.y },
    hout: p.hout ?? { x: p.x, y: p.y },
  };
}

export function pathToSvgD(points: PathPoint[], closed = false): string {
  if (points.length === 0) return '';
  const parts: string[] = [`M ${round2(points[0].x)} ${round2(points[0].y)}`];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const { hout } = sampleHandles(prev);
    const { hin } = sampleHandles(curr);
    const curved =
      (prev.hout != null && (prev.hout.x !== prev.x || prev.hout.y !== prev.y)) ||
      (curr.hin != null && (curr.hin.x !== curr.x || curr.hin.y !== curr.y));
    if (curved) {
      parts.push(
        `C ${round2(hout.x)} ${round2(hout.y)} ${round2(hin.x)} ${round2(hin.y)} ${round2(curr.x)} ${round2(curr.y)}`,
      );
    } else {
      parts.push(`L ${round2(curr.x)} ${round2(curr.y)}`);
    }
  }
  if (closed && points.length > 2) {
    const last = points[points.length - 1];
    const first = points[0];
    const { hout } = sampleHandles(last);
    const { hin } = sampleHandles(first);
    const curved =
      (last.hout != null && (last.hout.x !== last.x || last.hout.y !== last.y)) ||
      (first.hin != null && (first.hin.x !== first.x || first.hin.y !== first.y));
    if (curved) {
      parts.push(
        `C ${round2(hout.x)} ${round2(hout.y)} ${round2(hin.x)} ${round2(hin.y)} ${round2(first.x)} ${round2(first.y)}`,
      );
    } else {
      parts.push('Z');
    }
  }
  return parts.join(' ');
}

export function pathBounds(
  points: PathPoint[],
  padMm = 0,
): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: MIN_BBOX_MM, maxY: MIN_BBOX_MM, width: MIN_BBOX_MM, height: MIN_BBOX_MM };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const p of points) {
    include(p.x, p.y);
    if (p.hin) include(p.hin.x, p.hin.y);
    if (p.hout) include(p.hout.x, p.hout.y);
  }
  minX -= padMm;
  minY -= padMm;
  maxX += padMm;
  maxY += padMm;
  const width = Math.max(MIN_BBOX_MM, maxX - minX);
  const height = Math.max(MIN_BBOX_MM, maxY - minY);
  return { minX, minY, maxX, maxY, width, height };
}

export function normalizePathOrigin(path: LayerPath): {
  path: LayerPath;
  dx: number;
  dy: number;
  width: number;
  height: number;
} {
  const bounds = pathBounds(path.points);
  const dx = bounds.minX;
  const dy = bounds.minY;
  const points = path.points.map((p) => ({
    x: round2(p.x - dx),
    y: round2(p.y - dy),
    hin: p.hin ? { x: round2(p.hin.x - dx), y: round2(p.hin.y - dy) } : p.hin,
    hout: p.hout ? { x: round2(p.hout.x - dx), y: round2(p.hout.y - dy) } : p.hout,
  }));
  const next = { ...path, points };
  const nextBounds = pathBounds(points);
  return {
    path: next,
    dx,
    dy,
    width: round2(nextBounds.width),
    height: round2(nextBounds.height),
  };
}

export function ensureLinePath(layer: CanvasLayer): CanvasLayer {
  if (layer.type !== 'line') return layer;
  if (layer.meta?.path?.points && layer.meta.path.points.length >= 2) return layer;

  const strokeMm = Math.max(0.05, pxToMm(lineStrokeWidthPx(layer)));
  const w = Math.max(MIN_BBOX_MM, parseMm(layer.cssVars['--width'], 80));
  const h = strokeMm;
  const y = round2(h / 2);
  const path: LayerPath = {
    points: [
      { x: 0, y },
      { x: round2(w), y },
    ],
    closed: false,
  };
  return {
    ...layer,
    meta: { ...layer.meta, path },
    cssVars: {
      ...layer.cssVars,
      '--width': mm(w),
      '--height': mm(h),
      '--stroke-start': layer.cssVars['--stroke-start'] || 'none',
      '--stroke-end': layer.cssVars['--stroke-end'] || 'none',
    },
  };
}

export function applyPathToLayer(layer: CanvasLayer, path: LayerPath, originX: number, originY: number): CanvasLayer {
  const { path: normalized, width, height } = normalizePathOrigin(path);
  const strokePad = Math.max(pxToMm(lineStrokeWidthPx(layer)) / 2, MIN_BBOX_MM / 2);
  const { '--rotate': _rotate, ...restVars } = layer.cssVars;
  void _rotate;
  return {
    ...layer,
    meta: { ...layer.meta, path: normalized },
    cssVars: {
      ...restVars,
      '--translate-x': mm(originX),
      '--translate-y': mm(originY),
      '--width': mm(Math.max(width, MIN_BBOX_MM)),
      '--height': mm(Math.max(height, strokePad * 2, MIN_BBOX_MM)),
      '--background-color': 'transparent',
      '--fill-visible': '0',
      '--stroke-start': layer.cssVars['--stroke-start'] || 'none',
      '--stroke-end': layer.cssVars['--stroke-end'] || 'none',
    },
  };
}

export function bendSegment(path: LayerPath, segmentIndex: number, tx: number, ty: number): LayerPath {
  const points = path.points.map((p) => ({ ...p, hin: p.hin ? { ...p.hin } : p.hin, hout: p.hout ? { ...p.hout } : p.hout }));
  if (segmentIndex < 0 || segmentIndex >= points.length - 1) return path;
  const a = points[segmentIndex];
  const b = points[segmentIndex + 1];
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const ox = tx - mx;
  const oy = ty - my;
  a.hout = { x: round2(a.x + (b.x - a.x) / 3 + ox), y: round2(a.y + (b.y - a.y) / 3 + oy) };
  b.hin = { x: round2(b.x - (b.x - a.x) / 3 + ox), y: round2(b.y - (b.y - a.y) / 3 + oy) };
  return { ...path, points };
}

export function movePathPoint(path: LayerPath, index: number, x: number, y: number): LayerPath {
  const points = path.points.map((p, i) => {
    if (i !== index) return { ...p, hin: p.hin ? { ...p.hin } : p.hin, hout: p.hout ? { ...p.hout } : p.hout };
    const dx = x - p.x;
    const dy = y - p.y;
    return {
      x: round2(x),
      y: round2(y),
      hin: p.hin ? { x: round2(p.hin.x + dx), y: round2(p.hin.y + dy) } : p.hin,
      hout: p.hout ? { x: round2(p.hout.x + dx), y: round2(p.hout.y + dy) } : p.hout,
    };
  });
  return { ...path, points };
}

export function movePathHandle(
  path: LayerPath,
  index: number,
  which: 'hin' | 'hout',
  x: number,
  y: number,
  mirror = true,
): LayerPath {
  const points = path.points.map((p, i) => {
    if (i !== index) return { ...p, hin: p.hin ? { ...p.hin } : p.hin, hout: p.hout ? { ...p.hout } : p.hout };
    const next = { ...p, hin: p.hin ? { ...p.hin } : null, hout: p.hout ? { ...p.hout } : null };
    next[which] = { x: round2(x), y: round2(y) };
    if (mirror) {
      const other = which === 'hin' ? 'hout' : 'hin';
      next[other] = { x: round2(2 * p.x - x), y: round2(2 * p.y - y) };
    }
    return next;
  });
  return { ...path, points };
}

function splitCubic(
  p0: PathPoint,
  p1: PathPoint,
  t: number,
): { mid: PathPoint; leftEnd: PathPoint; rightStart: PathPoint } {
  const { hout: c1 } = sampleHandles(p0);
  const { hin: c2 } = sampleHandles(p1);
  const p01 = { x: p0.x + (c1.x - p0.x) * t, y: p0.y + (c1.y - p0.y) * t };
  const p12 = { x: c1.x + (c2.x - c1.x) * t, y: c1.y + (c2.y - c1.y) * t };
  const p23 = { x: c2.x + (p1.x - c2.x) * t, y: c2.y + (p1.y - c2.y) * t };
  const p012 = { x: p01.x + (p12.x - p01.x) * t, y: p01.y + (p12.y - p01.y) * t };
  const p123 = { x: p12.x + (p23.x - p12.x) * t, y: p12.y + (p23.y - p12.y) * t };
  const midPt = { x: p012.x + (p123.x - p012.x) * t, y: p012.y + (p123.y - p012.y) * t };
  const mid: PathPoint = {
    x: round2(midPt.x),
    y: round2(midPt.y),
    hin: { x: round2(p012.x), y: round2(p012.y) },
    hout: { x: round2(p123.x), y: round2(p123.y) },
  };
  return {
    mid,
    leftEnd: {
      ...p0,
      hout: { x: round2(p01.x), y: round2(p01.y) },
    },
    rightStart: {
      ...p1,
      hin: { x: round2(p23.x), y: round2(p23.y) },
      hout: p1.hout ? { ...p1.hout } : p1.hout,
    },
  };
}

export function splitPathAt(path: LayerPath, segmentIndex: number, t = 0.5): [LayerPath, LayerPath] | null {
  if (path.closed) return null;
  if (segmentIndex < 0 || segmentIndex >= path.points.length - 1) return null;
  const clampedT = Math.min(0.95, Math.max(0.05, t));
  const a = path.points[segmentIndex];
  const b = path.points[segmentIndex + 1];
  const { mid, leftEnd, rightStart } = splitCubic(a, b, clampedT);
  const leftPoints: PathPoint[] = [
    ...path.points.slice(0, segmentIndex).map((p) => ({ ...p })),
    { ...leftEnd, x: round2(a.x), y: round2(a.y) },
    {
      x: mid.x,
      y: mid.y,
      hin: mid.hin,
      hout: null,
    },
  ];
  leftPoints[leftPoints.length - 2] = {
    ...leftPoints[leftPoints.length - 2],
    hout: leftEnd.hout,
  };
  const rightPoints: PathPoint[] = [
    {
      x: mid.x,
      y: mid.y,
      hin: null,
      hout: mid.hout ?? null,
    },
    { ...rightStart, x: round2(b.x), y: round2(b.y) },
    ...path.points.slice(segmentIndex + 2).map((p) => ({ ...p })),
  ];
  rightPoints[1] = {
    ...rightPoints[1],
    hin: rightStart.hin,
  };
  return [
    { points: leftPoints, closed: false },
    { points: rightPoints, closed: false },
  ];
}

export function splitLineLayer(
  layer: CanvasLayer,
  segmentIndex: number,
  t = 0.5,
): [CanvasLayer, CanvasLayer] | null {
  const ensured = ensureLinePath(layer);
  const path = ensured.meta?.path;
  if (!path) return null;
  const split = splitPathAt(path, segmentIndex, t);
  if (!split) return null;
  const ox = parseMm(ensured.cssVars['--translate-x']);
  const oy = parseMm(ensured.cssVars['--translate-y']);
  const leftNorm = normalizePathOrigin(split[0]);
  const rightNorm = normalizePathOrigin(split[1]);
  const left = applyPathToLayer(
    { ...ensured, id: ensured.id },
    leftNorm.path,
    round2(ox + leftNorm.dx),
    round2(oy + leftNorm.dy),
  );
  const right = applyPathToLayer(
    { ...ensured, id: newId(), name: `${ensured.name} copy` },
    rightNorm.path,
    round2(ox + rightNorm.dx),
    round2(oy + rightNorm.dy),
  );
  return [left, right];
}

export function scalePathPoints(path: LayerPath, sx: number, sy: number): LayerPath {
  const scalePt = (p: { x: number; y: number }) => ({ x: round2(p.x * sx), y: round2(p.y * sy) });
  return {
    ...path,
    points: path.points.map((p) => ({
      x: round2(p.x * sx),
      y: round2(p.y * sy),
      hin: p.hin ? scalePt(p.hin) : p.hin,
      hout: p.hout ? scalePt(p.hout) : p.hout,
    })),
  };
}

export function closestSegmentIndex(path: LayerPath, x: number, y: number): { index: number; t: number; dist: number } {
  let best = { index: 0, t: 0.5, dist: Infinity };
  for (let i = 0; i < path.points.length - 1; i += 1) {
    const a = path.points[i];
    const b = path.points[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby || 1;
    let t = ((x - a.x) * abx + (y - a.y) * aby) / len2;
    t = Math.min(1, Math.max(0, t));
    const px = a.x + abx * t;
    const py = a.y + aby * t;
    const dist = Math.hypot(x - px, y - py);
    if (dist < best.dist) best = { index: i, t, dist };
  }
  return best;
}

export function togglePathClosed(path: LayerPath): LayerPath {
  if (path.points.length < 3) return path;
  return { ...path, closed: !path.closed };
}

export function pointInPolygon(x: number, y: number, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function rectIntersectsPolygon(
  rect: { x: number; y: number; w: number; h: number },
  polygon: Array<{ x: number; y: number }>,
): boolean {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
  if (corners.some((c) => pointInPolygon(c.x, c.y, polygon))) return true;
  if (polygon.some((p) => p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h)) {
    return true;
  }
  return pointInPolygon(rect.x + rect.w / 2, rect.y + rect.h / 2, polygon);
}

export function lineIntersectsPolygon(layer: CanvasLayer, polygon: Array<{ x: number; y: number }>): boolean {
  const ensured = ensureLinePath(layer);
  const path = ensured.meta?.path;
  if (!path?.points?.length) {
    const x = parseMm(layer.cssVars['--translate-x']);
    const y = parseMm(layer.cssVars['--translate-y']);
    const w = parseMm(layer.cssVars['--width'], 10);
    const h = parseMm(layer.cssVars['--height'], 10);
    return rectIntersectsPolygon({ x, y, w, h }, polygon);
  }
  const ox = parseMm(ensured.cssVars['--translate-x']);
  const oy = parseMm(ensured.cssVars['--translate-y']);
  for (const p of path.points) {
    if (pointInPolygon(ox + p.x, oy + p.y, polygon)) return true;
  }
  for (let i = 0; i < path.points.length - 1; i += 1) {
    const a = path.points[i];
    const b = path.points[i + 1];
    if (pointInPolygon(ox + (a.x + b.x) / 2, oy + (a.y + b.y) / 2, polygon)) return true;
  }
  return false;
}
