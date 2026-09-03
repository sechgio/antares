import type { CanvasLayer } from '../types';

export function patchLayersById(
  layers: CanvasLayer[],
  updates: Map<string, CanvasLayer>,
): CanvasLayer[] {
  if (updates.size === 0) return layers;
  const next = layers.slice();
  for (let i = 0; i < next.length; i++) {
    const u = updates.get(next[i]!.id);
    if (u) next[i] = u;
  }
  return next;
}

export function replaceLayerById(layers: CanvasLayer[], layer: CanvasLayer): CanvasLayer[] {
  const idx = layers.findIndex((l) => l.id === layer.id);
  if (idx < 0 || layers[idx] === layer) return layers;
  const next = layers.slice();
  next[idx] = layer;
  return next;
}
