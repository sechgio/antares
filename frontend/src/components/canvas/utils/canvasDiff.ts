import type { CanvasDocument, CanvasLayer, LayerCssVars, LayerMeta } from '../types';

export interface LayerPatch {
  id: string;
  changes: Partial<CanvasLayer>;
}

export interface CanvasDiff {
  /** Layers added in this step */
  addedLayers?: CanvasLayer[];
  /** IDs of layers removed in this step */
  removedLayerIds?: string[];
  /** Modified properties of existing layers */
  modifiedLayers?: LayerPatch[];
  /** Ordered list of layer IDs if the layer order changed */
  layerOrder?: string[];
  /** Top-level document metadata changes */
  docPatch?: Partial<Omit<CanvasDocument, 'layers'>>;
}

export interface HistoryStepDiff {
  type: 'diff';
  undoDiff: CanvasDiff;
  redoDiff: CanvasDiff;
}

export type HistoryStep = CanvasDocument | HistoryStepDiff;

export function isHistoryStepDiff(step: HistoryStep): step is HistoryStepDiff {
  return typeof step === 'object' && step !== null && (step as HistoryStepDiff).type === 'diff';
}

function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isDeepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (Array.isArray(a) || Array.isArray(b)) return false;

  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!isDeepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}

function computeLayerDiff(prev: CanvasLayer, next: CanvasLayer): Partial<CanvasLayer> | null {
  if (prev === next) return null;
  const changes: Partial<CanvasLayer> = {};
  let hasChanges = false;

  const simpleKeys: Array<keyof CanvasLayer> = [
    'type',
    'name',
    'value',
    'locked',
    'parentId',
    'visible',
    'pageIndex',
    'fillStyleId',
    'textStyleId',
    'effectStyleId',
  ];

  for (const key of simpleKeys) {
    if (prev[key] !== next[key]) {
      (changes[key] as unknown) = next[key];
      hasChanges = true;
    }
  }

  // Compare cssVars
  if (!isDeepEqual(prev.cssVars, next.cssVars)) {
    changes.cssVars = { ...next.cssVars };
    hasChanges = true;
  }

  // Compare meta
  if (!isDeepEqual(prev.meta, next.meta)) {
    changes.meta = next.meta ? { ...next.meta } : undefined;
    hasChanges = true;
  }

  return hasChanges ? changes : null;
}

/**
 * Compute the structural difference to transform `prev` into `next`.
 */
export function computeDocumentDiff(prev: CanvasDocument, next: CanvasDocument): CanvasDiff {
  if (prev === next) return {};

  const diff: CanvasDiff = {};

  // 1. Top-level document fields check
  const docPatch: Partial<Omit<CanvasDocument, 'layers'>> = {};
  let docChanged = false;

  const docKeys: Array<keyof Omit<CanvasDocument, 'layers'>> = [
    'version',
    'id',
    'name',
    'updatedAt',
    'page',
    'fields',
    'pages',
    'settings',
    'guides',
    'styles',
  ];

  for (const key of docKeys) {
    if (!isDeepEqual(prev[key], next[key])) {
      (docPatch[key] as unknown) = next[key];
      docChanged = true;
    }
  }

  if (docChanged) {
    diff.docPatch = docPatch;
  }

  // 2. Layer-level diff
  const prevLayerMap = new Map<string, CanvasLayer>();
  for (const layer of prev.layers) {
    prevLayerMap.set(layer.id, layer);
  }

  const nextLayerMap = new Map<string, CanvasLayer>();
  for (const layer of next.layers) {
    nextLayerMap.set(layer.id, layer);
  }

  // Added layers
  const addedLayers: CanvasLayer[] = [];
  for (const layer of next.layers) {
    if (!prevLayerMap.has(layer.id)) {
      addedLayers.push(layer);
    }
  }
  if (addedLayers.length > 0) {
    diff.addedLayers = addedLayers;
  }

  // Removed layers
  const removedLayerIds: string[] = [];
  for (const layer of prev.layers) {
    if (!nextLayerMap.has(layer.id)) {
      removedLayerIds.push(layer.id);
    }
  }
  if (removedLayerIds.length > 0) {
    diff.removedLayerIds = removedLayerIds;
  }

  // Modified layers
  const modifiedLayers: LayerPatch[] = [];
  for (const nextLayer of next.layers) {
    const prevLayer = prevLayerMap.get(nextLayer.id);
    if (prevLayer) {
      const changes = computeLayerDiff(prevLayer, nextLayer);
      if (changes) {
        modifiedLayers.push({ id: nextLayer.id, changes });
      }
    }
  }
  if (modifiedLayers.length > 0) {
    diff.modifiedLayers = modifiedLayers;
  }

  // Layer order check
  const prevOrder = prev.layers.map((l) => l.id);
  const nextOrder = next.layers.map((l) => l.id);
  if (!isDeepEqual(prevOrder, nextOrder)) {
    diff.layerOrder = nextOrder;
  }

  return diff;
}

/**
 * Apply a structural diff to `base` document to return a new `CanvasDocument`.
 */
export function applyDocumentDiff(base: CanvasDocument, diff: CanvasDiff): CanvasDocument {
  if (!diff || Object.keys(diff).length === 0) {
    return base;
  }

  // Build top-level doc
  const doc: CanvasDocument = {
    ...base,
    ...(diff.docPatch || {}),
    layers: base.layers,
  };

  const removedSet = new Set(diff.removedLayerIds || []);

  // Map modified layers
  const modifiedMap = new Map<string, Partial<CanvasLayer>>();
  if (diff.modifiedLayers) {
    for (const patch of diff.modifiedLayers) {
      modifiedMap.set(patch.id, patch.changes);
    }
  }

  // Build new layers list
  const layerMap = new Map<string, CanvasLayer>();

  for (const existingLayer of base.layers) {
    if (removedSet.has(existingLayer.id)) continue;
    const patch = modifiedMap.get(existingLayer.id);
    if (patch) {
      const updatedLayer: CanvasLayer = {
        ...existingLayer,
        ...patch,
        cssVars: patch.cssVars ? ({ ...patch.cssVars } as LayerCssVars) : existingLayer.cssVars,
        meta: patch.meta !== undefined ? (patch.meta ? ({ ...patch.meta } as LayerMeta) : undefined) : existingLayer.meta,
      };
      layerMap.set(updatedLayer.id, updatedLayer);
    } else {
      layerMap.set(existingLayer.id, existingLayer);
    }
  }

  // Add new layers
  if (diff.addedLayers) {
    for (const added of diff.addedLayers) {
      layerMap.set(added.id, added);
    }
  }

  // Reorder layers
  let finalLayers: CanvasLayer[];
  if (diff.layerOrder) {
    finalLayers = [];
    for (const id of diff.layerOrder) {
      const layer = layerMap.get(id);
      if (layer) {
        finalLayers.push(layer);
        layerMap.delete(id);
      }
    }
    // Append any extra layers not present in layerOrder (failsafe)
    for (const layer of layerMap.values()) {
      finalLayers.push(layer);
    }
  } else {
    // Preserve existing order + append added layers if order was unspecified
    finalLayers = Array.from(layerMap.values());
  }

  doc.layers = finalLayers;
  return doc;
}
