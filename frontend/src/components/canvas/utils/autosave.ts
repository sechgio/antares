import type { CanvasDocument } from '../types';

export const AUTOSAVE_DEBOUNCE_MS = 1200;
export const AUTOSAVE_MEDIUM_MS = 1800;
export const AUTOSAVE_LARGE_MS = 2500;

const MEDIUM_BYTES = 512 * 1024;
const LARGE_BYTES = 2 * 1024 * 1024;
const MEDIUM_LAYER_COUNT = 40;
const LARGE_LAYER_COUNT = 80;

function estimateJsonBytes(value: unknown, seen: Set<object>): number {
  if (value === null) return 4;
  if (typeof value === 'string') return value.length * 2 + 2;
  if (typeof value === 'number') return 8;
  if (typeof value === 'boolean') return 4;
  if (value === undefined) return 0;
  if (typeof value !== 'object') return 0;
  if (seen.has(value)) return 0;
  seen.add(value);

  if (Array.isArray(value)) {
    return 8 + value.reduce((total, item) => total + estimateJsonBytes(item, seen), 0);
  }

  return Object.entries(value).reduce(
    (total, [key, item]) => total + key.length * 2 + 4 + estimateJsonBytes(item, seen),
    16,
  );
}

export function estimateCanvasDocumentBytes(doc: CanvasDocument): number {
  return estimateJsonBytes(doc, new Set<object>());
}

export function autosaveDelayForDoc(doc: CanvasDocument | null | undefined): number {
  if (!doc || !Array.isArray(doc.layers)) return AUTOSAVE_DEBOUNCE_MS;

  const estimatedBytes = estimateCanvasDocumentBytes(doc);
  const layerCount = doc.layers.length;
  if (estimatedBytes > LARGE_BYTES || layerCount > LARGE_LAYER_COUNT) return AUTOSAVE_LARGE_MS;
  if (estimatedBytes > MEDIUM_BYTES || layerCount > MEDIUM_LAYER_COUNT) return AUTOSAVE_MEDIUM_MS;
  return AUTOSAVE_DEBOUNCE_MS;
}
