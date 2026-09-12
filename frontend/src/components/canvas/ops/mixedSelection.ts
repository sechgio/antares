import { parseMm, type CanvasLayer } from '../types';

export type MixedValue<T> = { mixed: true } | { mixed: false; value: T };

export function selectLayersByIds(
  layers: CanvasLayer[],
  ids: readonly string[],
  fallback?: CanvasLayer,
): CanvasLayer[] {
  if (ids.length === 0) return fallback ? [fallback] : [];
  const idSet = new Set(ids);
  return layers.filter((layer) => idSet.has(layer.id));
}

export function mixedCssVar(layers: CanvasLayer[], key: string): MixedValue<string> {
  if (layers.length === 0) return { mixed: false, value: '' };
  const first = layers[0]!.cssVars[key] ?? '';
  for (let i = 1; i < layers.length; i += 1) {
    if ((layers[i]!.cssVars[key] ?? '') !== first) return { mixed: true };
  }
  return { mixed: false, value: first };
}

export function mixedNumericMm(layers: CanvasLayer[], key: string): MixedValue<number> {
  const raw = mixedCssVar(layers, key);
  if (raw.mixed) return raw;
  return { mixed: false, value: parseMm(raw.value) };
}

export function mixedNumeric(layers: CanvasLayer[], key: string, fallback = 0): MixedValue<number> {
  const raw = mixedCssVar(layers, key);
  if (raw.mixed) return raw;
  const n = Number.parseFloat(raw.value);
  return { mixed: false, value: Number.isFinite(n) ? n : fallback };
}

export function applyCssVarToLayerIds(
  layers: CanvasLayer[],
  ids: readonly string[],
  key: string,
  value: string,
): CanvasLayer[] {
  if (ids.length === 0) return layers;
  const idSet = new Set(ids);
  let changed = false;
  const next = layers.map((layer) => {
    if (!idSet.has(layer.id) || layer.locked) return layer;
    if (layer.cssVars[key] === value) return layer;
    changed = true;
    return { ...layer, cssVars: { ...layer.cssVars, [key]: value } };
  });
  return changed ? next : layers;
}
