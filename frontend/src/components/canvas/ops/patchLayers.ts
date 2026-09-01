import type { CanvasLayer } from '../types';

/**
 * Patch selected layers by id. Untouched entries keep identity.
 * Allocates one shallow array copy (slice) then O(n) scan to write k updates —
 * cheaper than `map` + object spreads on every layer.
 */
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

/** Replace a single layer by id; returns same ref if id missing or layer unchanged. */
export function replaceLayerById(layers: CanvasLayer[], layer: CanvasLayer): CanvasLayer[] {
  const idx = layers.findIndex((l) => l.id === layer.id);
  if (idx < 0 || layers[idx] === layer) return layers;
  const next = layers.slice();
  next[idx] = layer;
  return next;
}
