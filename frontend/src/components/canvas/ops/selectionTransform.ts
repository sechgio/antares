import type { CanvasGuide, CanvasLayer } from '../types';
import { mm, parseMm } from '../types';
import { MM_TO_PX } from './drawHelpers';
import { applyGridToImageSlots } from './gridLayout';
import { applyLineStrokeWeight, mmToPxLength } from './layerStyle';
import { layerBounds, layerLocalBounds, parseRotateDeg, type RectMm } from './layerBounds';
import { expandWithDescendants } from './layerTree';
import { ensureLinePath, scalePathPoints } from './pathGeometry';

// Re-export the canonical RectMm so existing importers (guides, Artboard) keep working.
export type { RectMm };

export type HandlePos = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export type SmartGuide = { axis: 'x' | 'y'; pos: number };

export const SNAP_THRESHOLD_MM = 0.5;
export const POINTER_CLICK_PX = 4;

/** Screen-pixel snap feel (~5px) converted to mm at current zoom. */
export function snapThresholdMm(zoom: number, screenPx = 5): number {
  const z = Math.max(0.05, zoom);
  return screenPx / (MM_TO_PX * z);
}

export const DEFAULT_GRID_MM = 5;

export function snapToGridMm(value: number, gridMm: number): number {
  if (!(gridMm > 0) || !Number.isFinite(value)) return value;
  return Math.round(value / gridMm) * gridMm;
}

/** Snap a box so left/top/right/bottom land on the grid. */
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

/** True when pointer travel is small enough to treat as a click (not a drag). */
export function isPointerClick(dxPx: number, dyPx: number, thresholdPx = POINTER_CLICK_PX): boolean {
  return dxPx * dxPx + dyPx * dyPx <= thresholdPx * thresholdPx;
}

function isTransformable(layer: CanvasLayer): boolean {
  return layer.type !== 'frame' && layer.visible !== false && !layer.locked;
}

/** Axis-aligned union of selected transformable layers (includes rotation AABB). */
export function selectionBounds(layers: CanvasLayer[], ids: string[]): RectMm | null {
  const idSet = new Set(ids);
  const targets = layers.filter((l) => idSet.has(l.id) && isTransformable(l));
  if (!targets.length) return null;
  const boxes = targets.map(layerBounds);
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.right));
  const bottom = Math.max(...boxes.map((b) => b.bottom));
  return { x, y, w: right - x, h: bottom - y };
}

function rectsIntersect(a: RectMm, b: RectMm): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Layers whose bounds intersect the marquee (unlocked, visible, non-frame). */
export function layersInMarquee(layers: CanvasLayer[], marquee: RectMm): string[] {
  if (marquee.w <= 0 || marquee.h <= 0) return [];
  return layers.filter((l) => isTransformable(l) && rectsIntersect(layerBounds(l), marquee)).map((l) => l.id);
}

/** Translate selection by dx/dy mm. Negative coords are allowed (free canvas).
 * Selecting a group/grid also moves its descendants (including locked children). */
export function moveSelection(
  layers: CanvasLayer[],
  ids: string[],
  dxMm: number,
  dyMm: number,
): CanvasLayer[] {
  const roots = new Set(ids);
  const idSet = new Set(expandWithDescendants(layers, ids));
  return layers.map((layer) => {
    if (!idSet.has(layer.id) || layer.type === 'frame') return layer;
    if (roots.has(layer.id) && !isTransformable(layer)) return layer;
    if (!roots.has(layer.id) && layer.visible === false) return layer;
    return {
      ...layer,
      cssVars: {
        ...layer.cssVars,
        '--translate-x': mm(parseMm(layer.cssVars['--translate-x']) + dxMm),
        '--translate-y': mm(parseMm(layer.cssVars['--translate-y']) + dyMm),
      },
    };
  });
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

  // Side handles: expand the free axis and scale the other from center.
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

/**
 * Resize all selected layers by mapping them from the original group bbox
 * into the resized bbox (uniform scale per axis).
 * Grids re-layout their image slots to fill the new box (cols/rows/gap stay).
 */
export function resizeSelection(
  layers: CanvasLayer[],
  ids: string[],
  handle: HandlePos,
  dxMm: number,
  dyMm: number,
  options?: { aspectLock?: boolean; fromCenter?: boolean; targetBox?: RectMm },
): CanvasLayer[] {
  const idSet = new Set(ids);
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

  let next = layers.map((layer) => {
    if (!idSet.has(layer.id) || !isTransformable(layer)) return layer;
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
        return {
          ...moved,
          meta: { ...moved.meta, path: scalePathPoints(path, sx, sy) },
          cssVars: {
            ...moved.cssVars,
            '--border-width': ensured.cssVars['--border-width'],
            '--stroke-visible': ensured.cssVars['--stroke-visible'] || '1',
          },
        };
      }
      return applyLineStrokeWeight(moved, mmToPxLength(nextH));
    }
    return moved;
  });

  for (const id of ids) {
    const layer = next.find((l) => l.id === id);
    if (layer?.type === 'grid') {
      next = applyGridToImageSlots(next, id);
    }
  }
  return next;
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

/** Rotate selection around its bbox center. Optional 15° snap on the delta. */
export function rotateSelection(
  layers: CanvasLayer[],
  ids: string[],
  deltaDeg: number,
  options?: { snap15?: boolean },
): CanvasLayer[] {
  const idSet = new Set(ids);
  const bounds = selectionBounds(layers, ids);
  if (!bounds) return layers;

  let delta = deltaDeg;
  if (options?.snap15) {
    delta = Math.round(deltaDeg / 15) * 15;
  }
  if (delta === 0) return layers;

  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;

  return layers.map((layer) => {
    if (!idSet.has(layer.id) || !isTransformable(layer)) return layer;
    const b = layerLocalBounds(layer);
    const center = rotatePoint(b.cx, b.cy, cx, cy, delta);
    const nextRotate = normalizeDeg(parseRotateDeg(layer) + delta);
    return {
      ...layer,
      cssVars: {
        ...layer.cssVars,
        '--translate-x': mm(center.x - b.w / 2),
        '--translate-y': mm(center.y - b.h / 2),
        '--rotate': `${nextRotate}deg`,
      },
    };
  });
}

/** Export resize bbox helper for Artboard snap pipeline. */
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

function collectGuidePositions(
  layers: CanvasLayer[],
  excludeIds: Set<string>,
  page: { widthMm: number; heightMm: number },
  manualGuides: CanvasGuide[] = [],
): { xs: number[]; ys: number[] } {
  const xs = [0, page.widthMm / 2, page.widthMm];
  const ys = [0, page.heightMm / 2, page.heightMm];
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

/** Cache guide rails keyed by the layers array (gesture snapshot). WeakMap avoids a module singleton. */
const guideCacheByLayers = new WeakMap<
  CanvasLayer[],
  {
    excludeKey: string;
    pageW: number;
    pageH: number;
    guidesKey: string;
    xs: number[];
    ys: number[];
  }
>();

function guidePositionsCached(
  layers: CanvasLayer[],
  excludeIds: Set<string>,
  page: { widthMm: number; heightMm: number },
  manualGuides: CanvasGuide[] = [],
): { xs: number[]; ys: number[] } {
  const excludeKey = [...excludeIds].join('\0');
  const guidesKey = manualGuides.map((g) => `${g.axis}:${g.posMm}`).join('|');
  const hit = guideCacheByLayers.get(layers);
  if (
    hit &&
    hit.excludeKey === excludeKey &&
    hit.pageW === page.widthMm &&
    hit.pageH === page.heightMm &&
    hit.guidesKey === guidesKey
  ) {
    return { xs: hit.xs, ys: hit.ys };
  }
  const next = collectGuidePositions(layers, excludeIds, page, manualGuides);
  guideCacheByLayers.set(layers, {
    excludeKey,
    pageW: page.widthMm,
    pageH: page.heightMm,
    guidesKey,
    xs: next.xs,
    ys: next.ys,
  });
  return next;
}

/**
 * Adjust a proposed move so selection edges/centers snap to page or other layers.
 * Returns corrected delta and active guide lines (in mm).
 */
export function snapMoveWithGuides(
  layers: CanvasLayer[],
  ids: string[],
  dxMm: number,
  dyMm: number,
  page: { widthMm: number; heightMm: number },
  thresholdMm = SNAP_THRESHOLD_MM,
  manualGuides: CanvasGuide[] = [],
): { dx: number; dy: number; guides: SmartGuide[] } {
  const bounds = selectionBounds(layers, ids);
  if (!bounds) return { dx: dxMm, dy: dyMm, guides: [] };

  const exclude = new Set(expandWithDescendants(layers, ids));
  const { xs, ys } = guidePositionsCached(layers, exclude, page, manualGuides);

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
    for (const g of xs) {
      const dist = Math.abs(edge.pos - g);
      if (dist <= thresholdMm && dist < bestXDist) {
        bestXDist = dist;
        guideX = g;
        if (edge.kind === 'left') bestDx = g - bounds.x;
        else if (edge.kind === 'right') bestDx = g - (bounds.x + bounds.w);
        else bestDx = g - (bounds.x + bounds.w / 2);
      }
    }
  }

  for (const edge of edgesY) {
    for (const g of ys) {
      const dist = Math.abs(edge.pos - g);
      if (dist <= thresholdMm && dist < bestYDist) {
        bestYDist = dist;
        guideY = g;
        if (edge.kind === 'top') bestDy = g - bounds.y;
        else if (edge.kind === 'bottom') bestDy = g - (bounds.y + bounds.h);
        else bestDy = g - (bounds.y + bounds.h / 2);
      }
    }
  }

  const guides: SmartGuide[] = [];
  if (guideX != null) guides.push({ axis: 'x', pos: guideX });
  if (guideY != null) guides.push({ axis: 'y', pos: guideY });
  return { dx: bestDx, dy: bestDy, guides };
}

/**
 * Snap a resized selection bbox to page/sibling edges.
 * Returns adjusted box (mm) and active guides.
 */
export function snapResizeBox(
  layers: CanvasLayer[],
  ids: string[],
  box: RectMm,
  page: { widthMm: number; heightMm: number },
  thresholdMm = SNAP_THRESHOLD_MM,
  manualGuides: CanvasGuide[] = [],
): { box: RectMm; guides: SmartGuide[] } {
  const exclude = new Set(expandWithDescendants(layers, ids));
  const { xs, ys } = guidePositionsCached(layers, exclude, page, manualGuides);

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
    for (const g of xs) {
      const dist = Math.abs(edge.pos - g);
      if (dist <= thresholdMm && dist < bestX) {
        bestX = dist;
        guideX = g;
        if (edge.kind === 'left') {
          const right = x + w;
          x = g;
          w = Math.max(2, right - x);
        } else {
          w = Math.max(2, g - x);
        }
      }
    }
  }

  for (const edge of edgesY) {
    for (const g of ys) {
      const dist = Math.abs(edge.pos - g);
      if (dist <= thresholdMm && dist < bestY) {
        bestY = dist;
        guideY = g;
        if (edge.kind === 'top') {
          const bottom = y + h;
          y = g;
          h = Math.max(2, bottom - y);
        } else {
          h = Math.max(2, g - y);
        }
      }
    }
  }

  const guides: SmartGuide[] = [];
  if (guideX != null) guides.push({ axis: 'x', pos: guideX });
  if (guideY != null) guides.push({ axis: 'y', pos: guideY });
  return { box: { x, y, w, h }, guides };
}

/** Angle in degrees from bbox top-center to pointer (for rotate handle). */
export function angleFromCenter(cx: number, cy: number, x: number, y: number): number {
  return (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
}
