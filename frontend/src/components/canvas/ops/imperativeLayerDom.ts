import { expandWithDescendants } from './layerTree';
import { layerGeometry } from './layerGeometry';
import type { CanvasLayer } from '../types';

export interface GestureDomPlane {
  root: HTMLElement;
  ids: string[];
  indices: number[];
  els: (HTMLElement | null)[];
}

function queryLayerEl(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-layer-id="${id}"]`);
}

export function prepareGestureDomPlane(
  root: HTMLElement,
  layers: CanvasLayer[],
  ids: string[],
): GestureDomPlane {
  const idSet = new Set(expandWithDescendants(layers, ids));
  const plane: GestureDomPlane = { root, ids: [], indices: [], els: [] };
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    if (!idSet.has(layer.id) || layer.type === 'frame') continue;
    plane.ids.push(layer.id);
    plane.indices.push(i);
    plane.els.push(queryLayerEl(root, layer.id));
  }
  return plane;
}

function resolvePlaneEl(plane: GestureDomPlane, slot: number): HTMLElement | null {
  const id = plane.ids[slot]!;
  const current = plane.els[slot];
  if (current && current.dataset.layerId === id && plane.root.contains(current)) return current;
  const el = queryLayerEl(plane.root, id);
  plane.els[slot] = el;
  return el;
}

function planeLayerAt(plane: GestureDomPlane, layers: CanvasLayer[], slot: number): CanvasLayer | null {
  const layer = layers[plane.indices[slot]!];
  if (layer && layer.id === plane.ids[slot]) return layer;
  return null;
}

export function applyPlaneDomTransforms(
  plane: GestureDomPlane,
  layers: CanvasLayer[],
  options?: { scale?: number; willChange?: boolean },
): void {
  const scale = options?.scale ?? 1;
  const willChange = options?.willChange ?? true;
  for (let slot = 0; slot < plane.ids.length; slot++) {
    const layer = planeLayerAt(plane, layers, slot);
    if (!layer) continue;
    const el = resolvePlaneEl(plane, slot);
    if (!el) continue;
    const g = layerGeometry(layer, scale);
    el.style.transform = g.transform;
    if (g.transformOrigin) el.style.transformOrigin = g.transformOrigin;
    if (willChange) el.style.willChange = 'transform';
  }
}

export function applyPlaneDomGeometry(
  plane: GestureDomPlane,
  layers: CanvasLayer[],
  options?: { scale?: number; willChange?: boolean },
): void {
  const scale = options?.scale ?? 1;
  const willChange = options?.willChange ?? true;
  for (let slot = 0; slot < plane.ids.length; slot++) {
    const layer = planeLayerAt(plane, layers, slot);
    if (!layer) continue;
    const el = resolvePlaneEl(plane, slot);
    if (!el) continue;
    const g = layerGeometry(layer, scale);
    el.style.transform = g.transform;
    if (g.transformOrigin) el.style.transformOrigin = g.transformOrigin;
    const nextW = `${g.widthPx}px`;
    if (el.style.width !== nextW) el.style.width = nextW;
    const nextH = `${g.heightPx}px`;
    if (el.style.height !== nextH) el.style.height = nextH;
    if (willChange) el.style.willChange = 'transform';
  }
}

export function clearPlaneDomGestureStyles(plane: GestureDomPlane): void {
  for (let slot = 0; slot < plane.ids.length; slot++) {
    const el = plane.els[slot];
    if (!el || !plane.root.contains(el)) continue;
    el.style.willChange = '';
    if (el.style.transformOrigin) el.style.transformOrigin = '';
  }
}

export function applyLayerDomTransforms(
  root: HTMLElement,
  layers: CanvasLayer[],
  ids: string[],
  options?: { scale?: number; willChange?: boolean },
): void {
  applyPlaneDomTransforms(prepareGestureDomPlane(root, layers, ids), layers, options);
}

export function applyLayerDomGeometry(
  root: HTMLElement,
  layers: CanvasLayer[],
  ids: string[],
  options?: { scale?: number; willChange?: boolean },
): void {
  applyPlaneDomGeometry(prepareGestureDomPlane(root, layers, ids), layers, options);
}

export function clearLayerDomGestureStyles(
  root: HTMLElement,
  layers: CanvasLayer[],
  ids: string[],
): void {
  clearPlaneDomGestureStyles(prepareGestureDomPlane(root, layers, ids));
}

export function setCanvasGestureActive(active: boolean): void {
  if (active) document.body.dataset.canvasGesture = '1';
  else delete document.body.dataset.canvasGesture;
}
