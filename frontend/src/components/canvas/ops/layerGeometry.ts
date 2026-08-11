import type { CanvasLayer } from '../types';
import { parseMm } from '../types';
import { mmToScreenPx } from './drawHelpers';
import { buildLayerTransform } from './layerStyle';
import { ensureLinePath } from './pathGeometry';

/**
 * GEOMETRY CONTRACT — the single source of truth for layer geometry.
 *
 * drag (imperativeLayerDom), rest (LayerNode) and export (renderHtml) all
 * compose position/size from this one seam: translate × paint-transform ×
 * origin × line-height. Mid-drag preview === committed frame === export.
 *
 * Rules (kept identical to the previous LayerNode semantics):
 * - transform = `translate(x,y) [rotate scaleX scaleY]` (paint transform only
 *   when present, same order as buildLayerTransform).
 * - transformOrigin = `center center` only when a paint transform exists.
 * - width default 10mm (plain layer cssVars, as both renderers used).
 * - height default 10mm, except lines: use the ensured line height
 *   (ensureLinePath guarantees it; legacy fallback 2mm).
 */
export interface LayerGeometry {
  transform: string;
  transformOrigin?: string;
  widthPx: number;
  heightPx: number;
}

export function layerGeometry(layer: CanvasLayer, scale = 1): LayerGeometry {
  // Lines resolve through the ensured path so drag and rest read the same
  // width/height the renderer actually paints.
  const source = layer.type === 'line' ? ensureLinePath(layer) : layer;
  const x = parseMm(layer.cssVars['--translate-x']);
  const y = parseMm(layer.cssVars['--translate-y']);
  const w = parseMm(layer.cssVars['--width'], 10);
  const h =
    layer.type === 'line'
      ? parseMm(source.cssVars['--height'], parseMm(layer.cssVars['--height'], 2))
      : parseMm(layer.cssVars['--height'], 10);
  const translate = `translate(${mmToScreenPx(x, scale)}px, ${mmToScreenPx(y, scale)}px)`;
  const paintTx = buildLayerTransform(source.cssVars);
  return {
    transform: paintTx ? `${translate} ${paintTx}` : translate,
    transformOrigin: paintTx ? 'center center' : undefined,
    widthPx: mmToScreenPx(w, scale),
    heightPx: mmToScreenPx(h, scale),
  };
}
