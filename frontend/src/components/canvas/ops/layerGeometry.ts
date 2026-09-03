import type { CanvasLayer } from '../types';
import { parseMm } from '../types';
import { mmToScreenPx } from './drawHelpers';
import { buildLayerTransform } from './layerStyle';
import { ensureLinePath } from './pathGeometry';

export interface LayerGeometry {
  transform: string;
  transformOrigin?: string;
  widthPx: number;
  heightPx: number;
}

export function layerGeometry(layer: CanvasLayer, scale = 1): LayerGeometry {
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
