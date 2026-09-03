import type { CanvasGuide, CanvasLayer } from '../types';
import { mm, parseMm } from '../types';
import { MM_TO_PX } from './drawHelpers';
import { applyLineStrokeWeight, mmToPxLength } from './layerStyle';
import { layerBounds, layerLocalBounds, parseRotateDeg, type RectMm } from './layerBounds';
import {
  containerUsesLayoutConstraints,
  propagateContainerResize,
} from './layerOps';
import { expandWithDescendants } from './layerTree';
import { patchLayersById } from './patchLayers';
import { ensureLinePath, scalePathPoints } from './pathGeometry';

export type { RectMm };

export type HandlePos = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export type SmartGuide = { axis: 'x' | 'y'; pos: number };

export const SNAP_THRESHOLD_MM = 0.5;
export const SNAP_THRESHOLD_MAX_MM = 10;
export const POINTER_CLICK_PX = 4;

export function snapThresholdMm(zoom: number, screenPx = 5): number {
  const z = Math.max(0.05, zoom);
  return Math.min(screenPx / (MM_TO_PX * z), SNAP_THRESHOLD_MAX_MM);
}

export const DEFAULT_GRID_MM = 5;

export function snapToGridMm(value: number, gridMm: number): number {
  if (!(gridMm > 0) || !Number.isFinite(value)) return value;
  return Math.round(value / gridMm) * gridMm;
}

export function snapRectToGrid(box: RectMm, gridMm: number): RectMm {
  if (!(gridMm > 0)) return box;
  const x = snapToGridMm(box.x, gridMm);
  const y = snapToGridMm(box.y, gridMm);
  const right = snapToGridMm(box.x + box.w, gridMm);
  const bottom = snapToGridMm(box.y + box.h, gridMm);
  return {
    x,
    y,
    w: Math.max(gridMm, right - x),
    h: Math.max(gridMm, bottom - y),
  };
}

export function isPointerClick(dxPx: number, dyPx: number, thresholdPx = POINTER_CLICK_PX): boolean {
  return dxPx * dxPx + dyPx * dyPx <= thresholdPx * thresholdPx;
}

export function constrainMoveToAxis(
  dx: number,
  dy: number,
  lock: boolean,
): { dx: number; dy: number } {
  if (!lock) return { dx, dy };
  return Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy };
}

function isTransformable(layer: CanvasLayer): boolean {
  return layer.type !== 'frame' && layer.visible !== false && !layer.locked;
}

export function selectionBounds(layers: CanvasLayer[], ids: string[]): RectMm | null {
  if (!ids.length) return null;
  if (ids.length === 1) {
    const targetId = ids[0];
    const target = layers.find((l) => l.id === targetId);
    if (!target || !isTransformable(target)) return null;
    const b = layerBounds(target);
    return { x: b.x, y: b.y, w: b.w, h: b.h };
  }
  const idSet = new Set(ids);
  let minX = Infinity;
  let minY = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;
  let found = false;

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    if (idSet.has(layer.id) && isTransformable(layer)) {
      found = true;
      const b = layerBounds(layer);
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.right > maxRight) maxRight = b.right;
      if (b.bottom > maxBottom) maxBottom = b.bottom;
    }
  }

  if (!found) return null;
  return { x: minX, y: minY, w: maxRight - minX, h: maxBottom - minY };
}

function rectsIntersect(a: RectMm, b: RectMm): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function layersInMarquee(layers: CanvasLayer[], marquee: RectMm): string[] {
  if (marquee.w <= 0 || marquee.h <= 0) return [];
  return layers.filter((l) => isTransformable(l) && rectsIntersect(layerBounds(l), marquee)).map((l) => l.id);
}

export function moveSelection(
  layers: CanvasLayer[],
  ids: string[],
  dxMm: number,
  dyMm: number,
): CanvasLayer[] {
  if (dxMm === 0 && dyMm === 0) return layers;
  const roots = new Set(ids);
  const idSet = new Set(expandWithDescendants(layers, ids));
  const updates = new Map<string, CanvasLayer>();
  for (const layer of layers) {
    if (!idSet.has(layer.id) || layer.type === 'frame') continue;
    if (roots.has(layer.id) && !isTransformable(layer)) continue;
    if (!roots.has(layer.id) && layer.visible === false) continue;
    updates.set(layer.id, {
      ...layer,
      cssVars: {
        ...layer.cssVars,
        '--translate-x': mm(parseMm(layer.cssVars['--translate-x']) + dxMm),
        '--translate-y': mm(parseMm(layer.cssVars['--translate-y']) + dyMm),
      },
    });
  }
  return patchLayersById(layers, updates);
}

function applyAspectLock(
  origin: RectMm,
  next: RectMm,
  handle: HandlePos,
): RectMm {
  if (origin.w <= 0 || origin.h <= 0) return next;
  const ratio = origin.w / origin.h;
  let { x, y, w, h } = next;

  const fromCorner = handle.length === 2;
  if (fromCorner) {
    if (Math.abs(w - origin.w) >= Math.abs(h - origin.h)) {
      h = w / ratio;
    } else {
      w = h * ratio;
    }
    if (handle.includes('w')) x = origin.x + origin.w - w;
    if (handle.includes('n')) y = origin.y + origin.h - h;
    return { x, y, w, h };
  }

  if (handle === 'e' || handle === 'w') {
    h = w / ratio;
    y = origin.y + (origin.h - h) / 2;
    if (handle === 'w') x = origin.x + origin.w - w;
  } else {
    w = h * ratio;
    x = origin.x + (origin.w - w) / 2;
    if (handle === 'n') y = origin.y + origin.h - h;
  }
  return { x, y, w, h };
}

function resizeBBox(
  origin: RectMm,
  handle: HandlePos,
  dxMm: number,
  dyMm: number,
  options?: { fromCenter?: boolean },
): RectMm {
  let { x, y, w, h } = origin;
  if (options?.fromCenter) {
    if (handle.includes('e')) {
      w = Math.max(2, origin.w + 2 * dxMm);
      x = origin.x + origin.w / 2 - w / 2;
    }
    if (handle.includes('w')) {
      w = Math.max(2, origin.w - 2 * dxMm);
      x = origin.x + origin.w / 2 - w / 2;
    }
    if (handle.includes('s')) {
      h = Math.max(2, origin.h + 2 * dyMm);
      y = origin.y + origin.h / 2 - h / 2;
    }
    if (handle.includes('n')) {
      h = Math.max(2, origin.h - 2 * dyMm);
      y = origin.y + origin.h / 2 - h / 2;
    }
    return { x, y, w, h };
  }
  if (handle.includes('e')) w = Math.max(2, origin.w + dxMm);
  if (handle.includes('s')) h = Math.max(2, origin.h + dyMm);
  if (handle.includes('w')) {
    w = Math.max(2, origin.w - dxMm);
    x = origin.x + (origin.w - w);
  }
  if (handle.includes('n')) {
    h = Math.max(2, origin.h - dyMm);
    y = origin.y + (origin.h - h);
  }
  return { x, y, w, h };
}

export function resizeSelection(
  layers: CanvasLayer[],
  ids: string[],
  handle: HandlePos,
  dxMm: number,
  dyMm: number,
  options?: { aspectLock?: boolean; fromCenter?: boolean; targetBox?: RectMm },
): CanvasLayer[] {
  const roots = new Set(ids);
  const idSet = new Set(expandWithDescendants(layers, ids));
  const origin = selectionBounds(layers, ids);
  if (!origin || origin.w <= 0 || origin.h <= 0) return layers;

  let nextBox = options?.targetBox
    ? options.targetBox
    : resizeBBox(origin, handle, dxMm, dyMm, { fromCenter: options?.fromCenter });
  if (!options?.targetBox && options?.aspectLock) {
    nextBox = applyAspectLock(origin, nextBox, handle);
    nextBox = {
      ...nextBox,
      w: Math.max(2, nextBox.w),
      h: Math.max(2, nextBox.h),
    };
    if (options.fromCenter) {
      nextBox = {
        ...nextBox,
        x: origin.x + origin.w / 2 - nextBox.w / 2,
        y: origin.y + origin.h / 2 - nextBox.h / 2,
      };
    }
  }

  if (ids.length === 1) {
    const rootId = ids[0]!;
    const root = layers.find((l) => l.id === rootId);
    if (root && containerUsesLayoutConstraints(layers, rootId)) {
      const local = layerLocalBounds(root);
      const resized: CanvasLayer = {
        ...root,
        cssVars: {
          ...root.cssVars,
          '--translate-x': mm(nextBox.x),
          '--translate-y': mm(nextBox.y),
          '--width': mm(Math.max(1, nextBox.w)),
          '--height': mm(Math.max(1, nextBox.h)),
        },
      };
      const delta = {
        dx: nextBox.x - local.x,
        dy: nextBox.y - local.y,
        dw: nextBox.w - local.w,
        dh: nextBox.h - local.h,
      };
      const withRoot = patchLayersById(layers, new Map([[rootId, resized]]));
      return propagateContainerResize(withRoot, rootId, delta);
    }
  }

  const updates = new Map<string, CanvasLayer>();
  for (const layer of layers) {
    if (!idSet.has(layer.id) || layer.type === 'frame') continue;
    if (roots.has(layer.id) && !isTransformable(layer)) continue;
    if (!roots.has(layer.id) && layer.visible === false) continue;
    const b = layerLocalBounds(layer);
    const relX = (b.x - origin.x) / origin.w;
    const relY = (b.y - origin.y) / origin.h;
    const relW = b.w / origin.w;
    const relH = b.h / origin.h;
    const nextW = Math.max(1, relW * nextBox.w);
    const nextH = Math.max(layer.type === 'line' ? 0.5 : 1, relH * nextBox.h);
    const moved: CanvasLayer = {
      ...layer,
      cssVars: {
        ...layer.cssVars,
        '--translate-x': mm(nextBox.x + relX * nextBox.w),
        '--translate-y': mm(nextBox.y + relY * nextBox.h),
        '--width': mm(nextW),
        '--height': mm(nextH),
      },
    };
    if (layer.type === 'line') {
      const ensured = ensureLinePath(layer);
      const path = ensured.meta?.path;
      if (path && b.w > 0 && b.h > 0) {
        const sx = nextW / b.w;
        const sy = nextH / b.h;
        updates.set(layer.id, {
          ...moved,
          meta: { ...moved.meta, path: scalePathPoints(path, sx, sy) },
          cssVars: {
            ...moved.cssVars,
            '--border-width': ensured.cssVars['--border-width'],
            '--stroke-visible': ensured.cssVars['--stroke-visible'] || '1',
          },
        });
        continue;
      }
      updates.set(layer.id, applyLineStrokeWeight(moved, mmToPxLength(nextH)));
      continue;
    }
    updates.set(layer.id, moved);
  }

  return patchLayersById(layers, updates);
}

function rotatePoint(
  x: number,
  y: number,
  cx: number,
  cy: number,
  deg: number,
): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return Math.round(d * 1000) / 1000;
}

export function rotateSelection(
  layers: CanvasLayer[],
  ids: string[],
  deltaDeg: number,
  options?: { snap15?: boolean },
): CanvasLayer[] {
  const roots = new Set(ids);
  const idSet = new Set(expandWithDescendants(layers, ids));
  const bounds = selectionBounds(layers, ids);
  if (!bounds) return layers;

  let delta = deltaDeg;
  if (options?.snap15) {
    delta = Math.round(deltaDeg / 15) * 15;
  }
  if (delta === 0) return layers;

  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;

  const updates = new Map<string, CanvasLayer>();
  for (const layer of layers) {
    if (!idSet.has(layer.id) || layer.type === 'frame') continue;
    if (roots.has(layer.id) && !isTransformable(layer)) continue;
    if (!roots.has(layer.id) && layer.visible === false) continue;
    const b = layerLocalBounds(layer);
    const center = rotatePoint(b.cx, b.cy, cx, cy, delta);
    const nextRotate = normalizeDeg(parseRotateDeg(layer) + delta);
    updates.set(layer.id, {
      ...layer,
      cssVars: {
        ...layer.cssVars,
        '--translate-x': mm(center.x - b.w / 2),
        '--translate-y': mm(center.y - b.h / 2),
        '--rotate': `${nextRotate}deg`,
      },
    });
  }
  return patchLayersById(layers, updates);
}

export function computeResizeBox(
  origin: RectMm,
  handle: HandlePos,
  dxMm: number,
  dyMm: number,
  options?: { aspectLock?: boolean; fromCenter?: boolean },
): RectMm {
  let nextBox = resizeBBox(origin, handle, dxMm, dyMm, { fromCenter: options?.fromCenter });
  if (options?.aspectLock) {
    nextBox = applyAspectLock(origin, nextBox, handle);
    nextBox = {
      ...nextBox,
      w: Math.max(2, nextBox.w),
      h: Math.max(2, nextBox.h),
    };
    if (options.fromCenter) {
      nextBox = {
        ...nextBox,
        x: origin.x + origin.w / 2 - nextBox.w / 2,
        y: origin.y + origin.h / 2 - nextBox.h / 2,
      };
    }
  }
  return nextBox;
}

export type SnapRails = { xs: number[]; ys: number[] };

function collectGuidePositions(
  layers: CanvasLayer[],
  excludeIds: Set<string>,
  page: { widthMm: number; heightMm: number },
  manualGuides: CanvasGuide[] = [],
  pageMarginMm = 0,
): SnapRails {
  const xs = [0, page.widthMm / 2, page.widthMm];
  const ys = [0, page.heightMm / 2, page.heightMm];
  if (pageMarginMm > 0) {
    xs.push(pageMarginMm, page.widthMm - pageMarginMm);
    ys.push(pageMarginMm, page.heightMm - pageMarginMm);
  }
  for (const layer of layers) {
    if (excludeIds.has(layer.id) || !isTransformable(layer)) continue;
    const b = layerBounds(layer);
    xs.push(b.x, b.cx, b.right);
    ys.push(b.y, b.cy, b.bottom);
  }
  for (const g of manualGuides) {
    if (g.axis === 'x') xs.push(g.posMm);
    else ys.push(g.posMm);
  }
  return { xs, ys };
}

function sortRails(rails: SnapRails): SnapRails {
  return {
    xs: [...rails.xs].sort((a, b) => a - b),
    ys: [...rails.ys].sort((a, b) => a - b),
  };
}

function lowerBound(arr: number[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function nearestRailInRange(
  sorted: number[],
  pos: number,
  thresholdMm: number,
): { rail: number; dist: number } | null {
  const start = lowerBound(sorted, pos - thresholdMm);
  let best: { rail: number; dist: number } | null = null;
  for (let i = start; i < sorted.length; i++) {
    const g = sorted[i]!;
    if (g > pos + thresholdMm) break;
    const dist = Math.abs(pos - g);
    if (dist <= thresholdMm && (best == null || dist < best.dist)) {
      best = { rail: g, dist };
    }
  }
  return best;
}

const guideCacheByLayers = new WeakMap<
  CanvasLayer[],
  {
    excludeKey: string;
    pageW: number;
    pageH: number;
    guidesKey: string;
    marginMm: number;
    xs: number[];
    ys: number[];
  }
>();

function guidePositionsCached(
  layers: CanvasLayer[],
  excludeIds: Set<string>,
  page: { widthMm: number; heightMm: number },
  manualGuides: CanvasGuide[] = [],
  pageMarginMm = 0,
): SnapRails {
  const excludeKey = [...excludeIds].join('\0');
  const guidesKey = manualGuides.map((g) => `${g.axis}:${g.posMm}`).join('|');
  const hit = guideCacheByLayers.get(layers);
  if (
    hit &&
    hit.excludeKey === excludeKey &&
    hit.pageW === page.widthMm &&
    hit.pageH === page.heightMm &&
    hit.guidesKey === guidesKey &&
    hit.marginMm === pageMarginMm
  ) {
    return { xs: hit.xs, ys: hit.ys };
  }
  const next = sortRails(collectGuidePositions(layers, excludeIds, page, manualGuides, pageMarginMm));
  guideCacheByLayers.set(layers, {
    excludeKey,
    pageW: page.widthMm,
    pageH: page.heightMm,
    guidesKey,
    marginMm: pageMarginMm,
    xs: next.xs,
    ys: next.ys,
  });
  return next;
}

export function prepareSnapRails(
  layers: CanvasLayer[],
  ids: string[],
  page: { widthMm: number; heightMm: number },
  manualGuides: CanvasGuide[] = [],
  pageMarginMm = 0,
): SnapRails {
  const exclude = new Set(expandWithDescendants(layers, ids));
  return guidePositionsCached(layers, exclude, page, manualGuides, pageMarginMm);
}

export function snapMoveWithGuides(
  layers: CanvasLayer[],
  ids: string[],
  dxMm: number,
  dyMm: number,
  page: { widthMm: number; heightMm: number },
  thresholdMm = SNAP_THRESHOLD_MM,
  manualGuides: CanvasGuide[] = [],
  rails?: SnapRails,
  pageMarginMm = 0,
): { dx: number; dy: number; guides: SmartGuide[] } {
  const bounds = selectionBounds(layers, ids);
  if (!bounds) return { dx: dxMm, dy: dyMm, guides: [] };

  const { xs, ys } = rails ?? prepareSnapRails(layers, ids, page, manualGuides, pageMarginMm);

  const edgesX = [
    { kind: 'left' as const, pos: bounds.x + dxMm },
    { kind: 'cx' as const, pos: bounds.x + bounds.w / 2 + dxMm },
    { kind: 'right' as const, pos: bounds.x + bounds.w + dxMm },
  ];
  const edgesY = [
    { kind: 'top' as const, pos: bounds.y + dyMm },
    { kind: 'cy' as const, pos: bounds.y + bounds.h / 2 + dyMm },
    { kind: 'bottom' as const, pos: bounds.y + bounds.h + dyMm },
  ];

  let bestDx = dxMm;
  let bestDy = dyMm;
  let bestXDist = thresholdMm + 1;
  let bestYDist = thresholdMm + 1;
  let guideX: number | null = null;
  let guideY: number | null = null;

  for (const edge of edgesX) {
    const hit = nearestRailInRange(xs, edge.pos, thresholdMm);
    if (hit && hit.dist < bestXDist) {
      bestXDist = hit.dist;
      guideX = hit.rail;
      if (edge.kind === 'left') bestDx = hit.rail - bounds.x;
      else if (edge.kind === 'right') bestDx = hit.rail - (bounds.x + bounds.w);
      else bestDx = hit.rail - (bounds.x + bounds.w / 2);
    }
  }

  for (const edge of edgesY) {
    const hit = nearestRailInRange(ys, edge.pos, thresholdMm);
    if (hit && hit.dist < bestYDist) {
      bestYDist = hit.dist;
      guideY = hit.rail;
      if (edge.kind === 'top') bestDy = hit.rail - bounds.y;
      else if (edge.kind === 'bottom') bestDy = hit.rail - (bounds.y + bounds.h);
      else bestDy = hit.rail - (bounds.y + bounds.h / 2);
    }
  }

  const guides: SmartGuide[] = [];
  if (guideX != null) guides.push({ axis: 'x', pos: guideX });
  if (guideY != null) guides.push({ axis: 'y', pos: guideY });
  return { dx: bestDx, dy: bestDy, guides };
}

export function snapResizeBox(
  layers: CanvasLayer[],
  ids: string[],
  box: RectMm,
  page: { widthMm: number; heightMm: number },
  thresholdMm = SNAP_THRESHOLD_MM,
  manualGuides: CanvasGuide[] = [],
  rails?: SnapRails,
  pageMarginMm = 0,
): { box: RectMm; guides: SmartGuide[] } {
  const { xs, ys } = rails ?? prepareSnapRails(layers, ids, page, manualGuides, pageMarginMm);

  let { x, y, w, h } = box;
  let guideX: number | null = null;
  let guideY: number | null = null;
  let bestX = thresholdMm + 1;
  let bestY = thresholdMm + 1;

  const edgesX = [
    { kind: 'left' as const, pos: x },
    { kind: 'right' as const, pos: x + w },
  ];
  const edgesY = [
    { kind: 'top' as const, pos: y },
    { kind: 'bottom' as const, pos: y + h },
  ];

  for (const edge of edgesX) {
    const hit = nearestRailInRange(xs, edge.pos, thresholdMm);
    if (hit && hit.dist < bestX) {
      bestX = hit.dist;
      guideX = hit.rail;
      if (edge.kind === 'left') {
        const right = x + w;
        x = hit.rail;
        w = Math.max(2, right - x);
      } else {
        w = Math.max(2, hit.rail - x);
      }
    }
  }

  for (const edge of edgesY) {
    const hit = nearestRailInRange(ys, edge.pos, thresholdMm);
    if (hit && hit.dist < bestY) {
      bestY = hit.dist;
      guideY = hit.rail;
      if (edge.kind === 'top') {
        const bottom = y + h;
        y = hit.rail;
        h = Math.max(2, bottom - y);
      } else {
        h = Math.max(2, hit.rail - y);
      }
    }
  }

  const guides: SmartGuide[] = [];
  if (guideX != null) guides.push({ axis: 'x', pos: guideX });
  if (guideY != null) guides.push({ axis: 'y', pos: guideY });
  return { box: { x, y, w, h }, guides };
}

export function smartGuidesEqual(a: SmartGuide[], b: SmartGuide[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.axis !== b[i]!.axis || a[i]!.pos !== b[i]!.pos) return false;
  }
  return true;
}

export function angleFromCenter(cx: number, cy: number, x: number, y: number): number {
  return (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
}
