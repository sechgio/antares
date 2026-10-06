import type { CanvasDocument } from '../types';

function parseTableFieldKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { fieldKeys?: (string | null)[][] };
    if (!Array.isArray(parsed.fieldKeys)) return [];
    return parsed.fieldKeys.flat().filter((k): k is string => typeof k === 'string' && k.length > 0);
  } catch {
    return [];
  }
}

export function collectDemoFieldKeys(doc: CanvasDocument): string[] {
  const keys = new Set<string>();
  for (const layer of doc.layers) {
    if (layer.type === 'field' || layer.type === 'checkbox' || layer.type === 'signature') {
      const key = layer.meta?.key;
      if (key) keys.add(key);
    }
    if (layer.type === 'table') {
      for (const key of parseTableFieldKeys(layer.meta?.rowsData)) keys.add(key);
    }
  }
  return [...keys];
}
