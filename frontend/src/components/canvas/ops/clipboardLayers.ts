import type { CanvasLayer } from '../types';

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

export function writeClipboardLayersText(layers: CanvasLayer[]): void {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
  try {
    void navigator.clipboard.writeText(JSON.stringify(layers)).catch(() => {});
  } catch {
    /* permission / unavailable */
  }
}

export interface ClipboardCopyResult {
  layers: CanvasLayer[];
  createdUrls: string[];
}

export interface ClipboardCopyCoordinator {
  copy(layers: CanvasLayer[], resolve: () => Promise<ClipboardCopyResult>): Promise<void>;
  invalidate(): void;
}

export function createClipboardCopyCoordinator(
  onImmediate: (layers: CanvasLayer[]) => void,
  onResolved: (layers: CanvasLayer[]) => void,
  releaseUrl: (url: string) => void,
): ClipboardCopyCoordinator {
  let generation = 0;
  const activeUrls = new Set<string>();

  const releaseActive = () => {
    for (const url of activeUrls) releaseUrl(url);
    activeUrls.clear();
  };

  return {
    copy(layers: CanvasLayer[], resolve: () => Promise<ClipboardCopyResult>): Promise<void> {
      const currentGeneration = ++generation;
      releaseActive();
      onImmediate(layers);
      return Promise.resolve()
        .then(resolve)
        .then(({ layers: resolvedLayers, createdUrls }) => {
          if (currentGeneration !== generation) {
            for (const url of createdUrls) releaseUrl(url);
            return;
          }
          for (const url of createdUrls) activeUrls.add(url);
          onResolved(resolvedLayers);
        })
        .catch(() => {});
    },
    invalidate(): void {
      generation += 1;
      releaseActive();
    },
  };
}
