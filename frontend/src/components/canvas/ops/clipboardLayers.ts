import { mm, newId, parseMm, type CanvasLayer, type LayerCssVars } from '../types';
import { expandWithDescendants } from './layerTree';
import { selectionBounds } from './selectionTransform';

const GEOMETRY_VARS = new Set([
  '--translate-x',
  '--translate-y',
  '--width',
  '--height',
  '--rotate',
  '--scale-x',
  '--scale-y',
]);

export function extractAppearanceVars(vars: LayerCssVars): Partial<LayerCssVars> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined || GEOMETRY_VARS.has(key)) continue;
    out[key] = value;
  }
  return out as Partial<LayerCssVars>;
}

export function applyAppearanceVars(
  layers: CanvasLayer[],
  appearance: Partial<LayerCssVars>,
  ids: readonly string[],
): CanvasLayer[] {
  if (!ids.length) return layers;
  const entries = Object.entries(appearance).filter(([, v]) => v !== undefined);
  if (!entries.length) return layers;
  const idSet = new Set(ids);
  let changed = false;
  const next = layers.map((layer) => {
    if (!idSet.has(layer.id) || layer.locked || layer.type === 'frame') return layer;
    changed = true;
    const cssVars = { ...layer.cssVars };
    for (const [key, value] of entries) {
      cssVars[key as keyof LayerCssVars] = value;
    }
    return { ...layer, cssVars };
  });
  return changed ? next : layers;
}

export function pasteToReplaceLayers(
  layers: CanvasLayer[],
  incoming: CanvasLayer[],
  targetIds: readonly string[],
): { layers: CanvasLayer[]; newIds: string[] } | null {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const targets = targetIds.filter((id) => {
    const layer = byId.get(id);
    return layer && !layer.locked && layer.type !== 'frame';
  });
  if (!targets.length || !incoming.length) return null;

  const targetBounds = selectionBounds(layers, targets);
  if (!targetBounds) return null;
  const pageIndex = byId.get(targets[0]!)?.pageIndex ?? 0;

  const dedupedIncoming: CanvasLayer[] = [];
  const seenIncoming = new Set<string>();
  for (const l of incoming) {
    if (seenIncoming.has(l.id)) continue;
    seenIncoming.add(l.id);
    dedupedIncoming.push(l);
  }

  const incomingIds = new Set(dedupedIncoming.map((l) => l.id));
  const roots = dedupedIncoming.filter((l) => !l.parentId || !incomingIds.has(l.parentId));
  const sourceBounds = selectionBounds(dedupedIncoming, roots.map((l) => l.id));
  if (!sourceBounds) return null;
  const dx = targetBounds.x - sourceBounds.x;
  const dy = targetBounds.y - sourceBounds.y;

  const removed = new Set(expandWithDescendants(layers, targets));
  const kept = layers.filter((l) => !removed.has(l.id));
  const keptMasterKeys = new Set<string>();
  for (const l of kept) {
    keptMasterKeys.add(l.id);
    if (l.meta?.componentId) keptMasterKeys.add(l.meta.componentId);
  }

  const idMap = new Map(dedupedIncoming.map((l) => [l.id, newId()]));
  const clones = dedupedIncoming.map((layer) => {
    const meta = layer.meta ? { ...layer.meta } : undefined;
    if (meta?.instanceOf) {
      const remapped = idMap.get(meta.instanceOf);
      if (remapped) {
        meta.instanceOf = remapped;
      } else if (!keptMasterKeys.has(meta.instanceOf)) {
        // Master neither pasted nor present in the target document — drop the
        // dangling instance binding rather than render a broken component.
        delete meta.instanceOf;
        delete meta.variant;
        delete meta.variantProps;
        delete meta.variantBinding;
      }
    }
    if (meta?.componentId) {
      const remapped = idMap.get(meta.componentId);
      if (remapped) meta.componentId = remapped;
    }
    return {
      ...layer,
      id: idMap.get(layer.id)!,
      parentId: layer.parentId ? idMap.get(layer.parentId) : undefined,
      pageIndex,
      cssVars: {
        ...layer.cssVars,
        '--translate-x': mm(parseMm(layer.cssVars['--translate-x']) + dx),
        '--translate-y': mm(parseMm(layer.cssVars['--translate-y']) + dy),
      },
      meta,
    };
  });
  const newIds = roots.map((l) => idMap.get(l.id)!);

  return { layers: [...kept, ...clones], newIds };
}

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
