
import type { CanvasLayer } from '../types';
import { MM_TO_PX } from './drawHelpers';
import { layerBounds, layerBoundsMm, type RectMm } from './layerBounds';

export type { RectMm };
export { layerBoundsMm };

export const CULLING_MARGIN_MM = 40;
const ZOOM_FLOOR = 0.4;
const MARGIN_MAX_MM = CULLING_MARGIN_MM * 2;

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
  const effectiveMargin =
    marginMm === CULLING_MARGIN_MM
      ? Math.min(MARGIN_MAX_MM, Math.max(CULLING_MARGIN_MM, Math.round(CULLING_MARGIN_MM / Math.max(zoom, ZOOM_FLOOR))))
      : marginMm;
  return {
    x: (0 - pageLeft) / scale - effectiveMargin,
    y: (0 - pageTop) / scale - effectiveMargin,
    w: viewportW / scale + effectiveMargin * 2,
    h: viewportH / scale + effectiveMargin * 2,
  };
}

export function rectsOverlapMm(a: RectMm, b: RectMm): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function filterVisibleLayers(
  layers: CanvasLayer[],
  viewRect: RectMm | null,
  alwaysIds?: ReadonlySet<string>,
): CanvasLayer[] {
  if (!viewRect) return layers;
  return layers.filter(
    (layer) => (alwaysIds?.has(layer.id) ?? false) || rectsOverlapMm(layerBounds(layer), viewRect),
  );
}
