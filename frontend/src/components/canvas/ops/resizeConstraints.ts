/**
 * Resize constraints (Figma/Canva-like): a 9-point anchor pins an edge, corner
 * or the center of a layer so inspector W/H edits grow away from that anchor
 * instead of always from the top-left corner.
 */

import type { CanvasLayer } from '../types';
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

/** New origin so the pinned edge/center stays put after the size change. */
function anchoredStart(start: number, size: number, nextSize: number, edge: Edge): number {
  if (edge === 'start') return start;
  if (edge === 'center') return start + (size - nextSize) / 2;
  return start + size - nextSize;
}

/**
 * Resize W/H (mm) keeping the layer's anchor point fixed on canvas.
 * Anchor 'tl' reproduces the legacy behavior (position untouched).
 */
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

/**
 * Inspector W/H edit with aspect-lock + resize constraint applied.
 * Aspect lock resolves both dimensions first, then the anchor fixes position.
 */
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
