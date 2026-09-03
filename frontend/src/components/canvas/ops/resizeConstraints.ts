
import type { CanvasLayer, FrameConstraint } from '../types';
import { mm, parseMm } from '../types';
import { resizeWithAspectLock } from './layerStyle';

export type ResizeAnchor = 'tl' | 'tc' | 'tr' | 'cl' | 'cc' | 'cr' | 'bl' | 'bc' | 'br';

export const RESIZE_ANCHORS: readonly ResizeAnchor[] = [
  'tl',
  'tc',
  'tr',
  'cl',
  'cc',
  'cr',
  'bl',
  'bc',
  'br',
];

export const DEFAULT_RESIZE_ANCHOR: ResizeAnchor = 'tl';

export function parseResizeAnchor(raw: string | undefined): ResizeAnchor {
  return (RESIZE_ANCHORS as readonly string[]).includes(raw ?? '')
    ? (raw as ResizeAnchor)
    : DEFAULT_RESIZE_ANCHOR;
}

type Edge = 'start' | 'center' | 'end';

function anchoredStart(start: number, size: number, nextSize: number, edge: Edge): number {
  if (edge === 'start') return start;
  if (edge === 'center') return start + (size - nextSize) / 2;
  return start + size - nextSize;
}

export function applyAnchoredResize(
  layer: CanvasLayer,
  next: { w?: number; h?: number },
  anchor: ResizeAnchor,
): CanvasLayer {
  const x = parseMm(layer.cssVars['--translate-x']);
  const y = parseMm(layer.cssVars['--translate-y']);
  const w = parseMm(layer.cssVars['--width'], 10);
  const h = parseMm(layer.cssVars['--height'], 10);
  const nextW = Math.max(1, next.w ?? w);
  const nextH = Math.max(1, next.h ?? h);
  const hEdge: Edge = anchor[1] === 'l' ? 'start' : anchor[1] === 'c' ? 'center' : 'end';
  const vEdge: Edge = anchor[0] === 't' ? 'start' : anchor[0] === 'c' ? 'center' : 'end';
  return {
    ...layer,
    cssVars: {
      ...layer.cssVars,
      '--width': mm(nextW),
      '--height': mm(nextH),
      '--translate-x': mm(anchoredStart(x, w, nextW, hEdge)),
      '--translate-y': mm(anchoredStart(y, h, nextH, vEdge)),
    },
  };
}

export function resizeLayerAnchored(
  layer: CanvasLayer,
  dim: 'width' | 'height',
  valueMm: number,
): CanvasLayer {
  const locked = resizeWithAspectLock(layer, dim, valueMm);
  return applyAnchoredResize(
    layer,
    {
      w: parseMm(locked.cssVars['--width'], 10),
      h: parseMm(locked.cssVars['--height'], 10),
    },
    parseResizeAnchor(layer.cssVars['--resize-anchor']),
  );
}

export type ParentResizeDelta = { dx: number; dy: number; dw: number; dh: number };

export function applyParentConstraint(
  child: CanvasLayer,
  parentDelta: ParentResizeDelta,
  cH: FrameConstraint | undefined,
  cV: FrameConstraint | undefined,
  parentBefore?: { x: number; y: number; w: number; h: number },
): CanvasLayer {
  const { dx, dy, dw, dh } = parentDelta;
  const x = parseMm(child.cssVars['--translate-x']);
  const y = parseMm(child.cssVars['--translate-y']);
  const w = Math.max(1, parseMm(child.cssVars['--width'], 10));
  const h = Math.max(1, parseMm(child.cssVars['--height'], 10));

  const axis = (
    constraint: FrameConstraint | undefined,
    start: number,
    size: number,
    dStart: number,
    dSize: number,
    parentStart: number,
    parentSize: number,
  ): { start: number; size: number } => {
    if (!constraint) return { start, size };
    if (constraint === 'start') {
      return { start: start + dStart, size };
    }
    if (constraint === 'end') {
      return { start: start + dStart, size: Math.max(1, size + dSize) };
    }
    if (constraint === 'center') {
      return { start: start + dStart + dSize / 2, size };
    }
    if (!(parentSize > 0)) return { start: start + dStart, size };
    const sx = (parentSize + dSize) / parentSize;
    const rel = start - parentStart;
    return {
      start: parentStart + dStart + rel * sx,
      size: Math.max(1, size * sx),
    };
  };

  const px = parentBefore?.x ?? 0;
  const py = parentBefore?.y ?? 0;
  const pw = parentBefore?.w && parentBefore.w > 0 ? parentBefore.w : 1;
  const ph = parentBefore?.h && parentBefore.h > 0 ? parentBefore.h : 1;

  const nextH = axis(cH, x, w, dx, dw, px, pw);
  const nextV = axis(cV, y, h, dy, dh, py, ph);

  return {
    ...child,
    cssVars: {
      ...child.cssVars,
      '--translate-x': mm(nextH.start),
      '--translate-y': mm(nextV.start),
      '--width': mm(nextH.size),
      '--height': mm(nextV.size),
    },
  };
}
