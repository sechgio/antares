/**
 * Viewport-based layer culling (virtualized rendering).
 * Only layers intersecting the visible page region are mounted in the DOM,
 * keeping pan/zoom/drag smooth on documents with many layers.
 */

import type { CanvasLayer } from '../types';
import { MM_TO_PX } from './drawHelpers';
import { layerBoundsMm, type RectMm } from './layerBounds';

// Re-export for existing importers of these symbols from viewportCulling.
export type { RectMm };
export { layerBoundsMm };

/** Overscan around the viewport so layers do not pop in while panning. */
export const CULLING_MARGIN_MM = 40;

/**
 * Page region (mm) currently visible in the viewport, expanded by `marginMm`.
 * The page is centered on the viewport and offset by pan (screen px).
 * Returns null for degenerate viewports (caller renders everything).
 */
export function visiblePageRectMm(
  viewportW: number,
  viewportH: number,
  pan: { x: number; y: number },
  zoom: number,
  pageWidthPx: number,
  pageHeightPx: number,
  marginMm = CULLING_MARGIN_MM,
): RectMm | null {
  if (viewportW < 1 || viewportH < 1 || zoom <= 0) return null;
  const pageLeft = viewportW / 2 + pan.x - (pageWidthPx * zoom) / 2;
  const pageTop = viewportH / 2 + pan.y - (pageHeightPx * zoom) / 2;
  const scale = zoom * MM_TO_PX;
  return {
    x: (0 - pageLeft) / scale - marginMm,
    y: (0 - pageTop) / scale - marginMm,
    w: viewportW / scale + marginMm * 2,
    h: viewportH / scale + marginMm * 2,
  };
}

export function rectsOverlapMm(a: RectMm, b: RectMm): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Layers to render: those intersecting the visible page rect plus `alwaysIds`
 * (selection, inline/path editing) so interaction chrome never loses its node.
 */
export function filterVisibleLayers(
  layers: CanvasLayer[],
  viewRect: RectMm | null,
  alwaysIds?: ReadonlySet<string>,
): CanvasLayer[] {
  if (!viewRect) return layers;
  return layers.filter(
    (layer) => (alwaysIds?.has(layer.id) ?? false) || rectsOverlapMm(layerBoundsMm(layer), viewRect),
  );
}
