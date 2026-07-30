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

/** Replace a single layer by id; returns same ref if id missing. */
export function replaceLayerById(layers: CanvasLayer[], layer: CanvasLayer): CanvasLayer[] {
  const updates = new Map<string, CanvasLayer>([[layer.id, layer]]);
  return patchLayersById(layers, updates);
}
