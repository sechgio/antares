import { mmToScreenPx } from './drawHelpers';
import { expandWithDescendants } from './layerTree';
import { buildLayerTransform } from './layerStyle';
import type { CanvasLayer } from '../types';
import { parseMm } from '../types';

/** Combined translate + rotate/flip transform matching LayerNode positioning. */
export function layerDomTransform(layer: CanvasLayer, scale = 1): string {
  const x = parseMm(layer.cssVars['--translate-x']);
  const y = parseMm(layer.cssVars['--translate-y']);
  const translate = `translate(${mmToScreenPx(x, scale)}px, ${mmToScreenPx(y, scale)}px)`;
  const paintTx = buildLayerTransform(layer.cssVars);
  return paintTx ? `${translate} ${paintTx}` : translate;
}

function forGestureLayerEls(
  root: HTMLElement,
  layers: CanvasLayer[],
  ids: string[],
  visit: (el: HTMLElement, layer: CanvasLayer) => void,
): void {
  const idSet = new Set(expandWithDescendants(layers, ids));
  const byId = new Map(layers.map((l) => [l.id, l]));
  for (const id of idSet) {
    const layer = byId.get(id);
    if (!layer || layer.type === 'frame') continue;
    const el = root.querySelector<HTMLElement>(`[data-layer-id="${id}"]`);
    if (!el) continue;
    visit(el, layer);
  }
}

/**
 * Write live drag positions to the DOM without a React commit.
 * Touches selection roots and descendants (same set as moveSelection).
 */
export function applyLayerDomTransforms(
  root: HTMLElement,
  layers: CanvasLayer[],
  ids: string[],
  options?: { scale?: number; willChange?: boolean },
): void {
  const scale = options?.scale ?? 1;
  const willChange = options?.willChange ?? true;
  forGestureLayerEls(root, layers, ids, (el, layer) => {
    el.style.transform = layerDomTransform(layer, scale);
    if (willChange) el.style.willChange = 'transform';
  });
}

/**
 * Write live resize/rotate geometry (transform + box size) without a React commit.
 * Matches LayerNode's absolute layout: left/top 0 + translate + width/height in px.
 */
export function applyLayerDomGeometry(
  root: HTMLElement,
  layers: CanvasLayer[],
  ids: string[],
  options?: { scale?: number; willChange?: boolean },
): void {
  const scale = options?.scale ?? 1;
  const willChange = options?.willChange ?? true;
  forGestureLayerEls(root, layers, ids, (el, layer) => {
    const w = parseMm(layer.cssVars['--width'], 10);
    const h = parseMm(layer.cssVars['--height'], 10);
    el.style.transform = layerDomTransform(layer, scale);
    el.style.width = `${mmToScreenPx(w, scale)}px`;
    el.style.height = `${mmToScreenPx(h, scale)}px`;
    if (willChange) el.style.willChange = 'transform';
  });
}

/** Drop compositor hints left by mid-gesture DOM writes (React re-applies layout on commit). */
export function clearLayerDomGestureStyles(
  root: HTMLElement,
  layers: CanvasLayer[],
  ids: string[],
): void {
  forGestureLayerEls(root, layers, ids, (el) => {
    el.style.willChange = '';
  });
}

export function setCanvasGestureActive(active: boolean): void {
  if (active) document.body.dataset.canvasGesture = '1';
  else delete document.body.dataset.canvasGesture;
}
