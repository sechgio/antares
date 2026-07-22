import type { CanvasLayer } from '../types';
import { mm, parseMm } from '../types';
import { expandWithDescendants } from './layerTree';

export type HandlePos = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export type RectMm = { x: number; y: number; w: number; h: number };

export type SmartGuide = { axis: 'x' | 'y'; pos: number };

export const SNAP_THRESHOLD_MM = 0.5;
export const POINTER_CLICK_PX = 4;

/** True when pointer travel is small enough to treat as a click (not a drag). */
export function isPointerClick(dxPx: number, dyPx: number, thresholdPx = POINTER_CLICK_PX): boolean {
  return dxPx * dxPx + dyPx * dyPx <= thresholdPx * thresholdPx;
}

function layerBounds(layer: CanvasLayer): RectMm & { right: number; bottom: number; cx: number; cy: number } {
  const x = parseMm(layer.cssVars['--translate-x']);
  const y = parseMm(layer.cssVars['--translate-y']);
  const w = parseMm(layer.cssVars['--width'], 10);
  const h = parseMm(layer.cssVars['--height'], 10);
  return { x, y, w, h, right: x + w, bottom: y + h, cx: x + w / 2, cy: y + h / 2 };
}

function isTransformable(layer: CanvasLayer): boolean {
  return layer.type !== 'frame' && layer.visible !== false && !layer.locked;
}

function parseRotateDeg(layer: CanvasLayer): number {
  return parseFloat(layer.cssVars['--rotate'] || '0') || 0;
}

/** Axis-aligned union of selected transformable layers. */
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

function resizeBBox(origin: RectMm, handle: HandlePos, dxMm: number, dyMm: number): RectMm {
  let { x, y, w, h } = origin;
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
 */
export function resizeSelection(
  layers: CanvasLayer[],
  ids: string[],
  handle: HandlePos,
  dxMm: number,
  dyMm: number,
  options?: { aspectLock?: boolean },
): CanvasLayer[] {
  const idSet = new Set(ids);
  const origin = selectionBounds(layers, ids);
  if (!origin || origin.w <= 0 || origin.h <= 0) return layers;

  let nextBox = resizeBBox(origin, handle, dxMm, dyMm);
  if (options?.aspectLock) {
    nextBox = applyAspectLock(origin, nextBox, handle);
    nextBox = {
      ...nextBox,
      w: Math.max(2, nextBox.w),
      h: Math.max(2, nextBox.h),
    };
  }

  return layers.map((layer) => {
    if (!idSet.has(layer.id) || !isTransformable(layer)) return layer;
    const b = layerBounds(layer);
    const relX = (b.x - origin.x) / origin.w;
    const relY = (b.y - origin.y) / origin.h;
    const relW = b.w / origin.w;
    const relH = b.h / origin.h;
    return {
      ...layer,
      cssVars: {
        ...layer.cssVars,
        '--translate-x': mm(nextBox.x + relX * nextBox.w),
        '--translate-y': mm(nextBox.y + relY * nextBox.h),
        '--width': mm(Math.max(1, relW * nextBox.w)),
        '--height': mm(Math.max(1, relH * nextBox.h)),
      },
    };
  });
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
    const b = layerBounds(layer);
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

function collectGuidePositions(
  layers: CanvasLayer[],
  excludeIds: Set<string>,
  page: { widthMm: number; heightMm: number },
): { xs: number[]; ys: number[] } {
  const xs = [0, page.widthMm / 2, page.widthMm];
  const ys = [0, page.heightMm / 2, page.heightMm];
  for (const layer of layers) {
    if (excludeIds.has(layer.id) || !isTransformable(layer)) continue;
    const b = layerBounds(layer);
    xs.push(b.x, b.cx, b.right);
    ys.push(b.y, b.cy, b.bottom);
  }
  return { xs, ys };
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
): { dx: number; dy: number; guides: SmartGuide[] } {
  const bounds = selectionBounds(layers, ids);
  if (!bounds) return { dx: dxMm, dy: dyMm, guides: [] };

  const exclude = new Set(ids);
  const { xs, ys } = collectGuidePositions(layers, exclude, page);

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

/** Angle in degrees from bbox top-center to pointer (for rotate handle). */
export function angleFromCenter(cx: number, cy: number, x: number, y: number): number {
  return (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
}
