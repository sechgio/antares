import type { CanvasLayer } from '../types';

/**
 * Parse system-clipboard JSON into canvas layers (best-effort).
 * Minimal shape: array of objects with `type` (string) and `cssVars` (object).
 */
export function parseClipboardLayers(text: string): CanvasLayer[] | null {
  if (!text || typeof text !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const layers: CanvasLayer[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') return null;
    const rec = item as Record<string, unknown>;
    if (typeof rec.type !== 'string' || !rec.type) return null;
    if (!rec.cssVars || typeof rec.cssVars !== 'object' || Array.isArray(rec.cssVars)) return null;
    layers.push(item as CanvasLayer);
  }
  return layers;
}

/** Best-effort write of layers JSON to the system clipboard. Never throws. */
export function writeClipboardLayersText(layers: CanvasLayer[]): void {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
  try {
    void navigator.clipboard.writeText(JSON.stringify(layers)).catch(() => {});
  } catch {
    /* permission / unavailable */
  }
}
