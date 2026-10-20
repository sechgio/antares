import { expandWithDescendants } from './layerTree';
import { layerGeometry } from './layerGeometry';
import type { CanvasLayer } from '../types';

const layerElCache = new WeakMap<HTMLElement, Map<string, HTMLElement>>();

function findLayerEl(root: HTMLElement, id: string): HTMLElement | null {
  let cache = layerElCache.get(root);
  if (!cache) {
    cache = new Map();
    layerElCache.set(root, cache);
  }
  const cached = cache.get(id);
  if (cached && root.contains(cached) && cached.dataset.layerId === id) return cached;
  const el = root.querySelector<HTMLElement>(`[data-layer-id="${id}"]`);
  if (el) cache.set(id, el);
  else cache.delete(id);
  return el;
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
    const el = findLayerEl(root, id);
    if (!el) continue;
    visit(el, layer);
  }
}

export function applyLayerDomTransforms(
  root: HTMLElement,
  layers: CanvasLayer[],
  ids: string[],
  options?: { scale?: number; willChange?: boolean },
): void {
  const scale = options?.scale ?? 1;
  const willChange = options?.willChange ?? true;
  forGestureLayerEls(root, layers, ids, (el, layer) => {
    const g = layerGeometry(layer, scale);
    el.style.transform = g.transform;
    if (g.transformOrigin) el.style.transformOrigin = g.transformOrigin;
    if (willChange) el.style.willChange = 'transform';
  });
}

export function applyLayerDomGeometry(
  root: HTMLElement,
  layers: CanvasLayer[],
  ids: string[],
  options?: { scale?: number; willChange?: boolean },
): void {
  const scale = options?.scale ?? 1;
  const willChange = options?.willChange ?? true;
  forGestureLayerEls(root, layers, ids, (el, layer) => {
    const g = layerGeometry(layer, scale);
    el.style.transform = g.transform;
    if (g.transformOrigin) el.style.transformOrigin = g.transformOrigin;
    const nextW = `${g.widthPx}px`;
    if (el.style.width !== nextW) el.style.width = nextW;
    const nextH = `${g.heightPx}px`;
    if (el.style.height !== nextH) el.style.height = nextH;
    if (willChange) el.style.willChange = 'transform';
  });
}

export function clearLayerDomGestureStyles(
  root: HTMLElement,
  layers: CanvasLayer[],
  ids: string[],
): void {
  forGestureLayerEls(root, layers, ids, (el) => {
    el.style.willChange = '';
    if (el.style.transformOrigin) el.style.transformOrigin = '';
  });
  layerElCache.delete(root);
}

export function setCanvasGestureActive(active: boolean): void {
  if (active) document.body.dataset.canvasGesture = '1';
  else delete document.body.dataset.canvasGesture;
}
