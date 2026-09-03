import type { CanvasDocument, CanvasLayer, LayerCssVars, LayerMeta } from '../types';

export interface LayerPatch {
  id: string;
  changes: Partial<CanvasLayer>;
}

export interface CanvasDiff {
  addedLayers?: CanvasLayer[];
  removedLayerIds?: string[];
  modifiedLayers?: LayerPatch[];
  layerOrder?: string[];
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

function isShallowEqualDict(a: Record<string, unknown> | undefined | null, b: Record<string, unknown> | undefined | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    const k = keysA[i];
    if (a[k] !== b[k]) return false;
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

  if (prev.cssVars !== next.cssVars && !isShallowEqualDict(prev.cssVars as unknown as Record<string, unknown>, next.cssVars as unknown as Record<string, unknown>)) {
    changes.cssVars = { ...next.cssVars };
    hasChanges = true;
  }

  if (prev.meta !== next.meta && !isShallowEqualDict(prev.meta as unknown as Record<string, unknown>, next.meta as unknown as Record<string, unknown>) && !isDeepEqual(prev.meta, next.meta)) {
    changes.meta = next.meta ? { ...next.meta } : undefined;
    hasChanges = true;
  }

  return hasChanges ? changes : null;
}

export function computeDocumentDiff(prev: CanvasDocument, next: CanvasDocument): CanvasDiff {
  if (prev === next) return {};

  const diff: CanvasDiff = {};

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
    const pVal = prev[key];
    const nVal = next[key];
    if (pVal !== nVal && !isDeepEqual(pVal, nVal)) {
      (docPatch[key] as unknown) = nVal;
      docChanged = true;
    }
  }

  if (docChanged) {
    diff.docPatch = docPatch;
  }

  if (prev.layers !== next.layers) {
    const prevLayers = prev.layers;
    const nextLayers = next.layers;

    let sameOrderAndIds = prevLayers.length === nextLayers.length;
    if (sameOrderAndIds) {
      for (let i = 0; i < prevLayers.length; i++) {
        if (prevLayers[i].id !== nextLayers[i].id) {
          sameOrderAndIds = false;
          break;
        }
      }
    }

    if (sameOrderAndIds) {
      const modifiedLayers: LayerPatch[] = [];
      for (let i = 0; i < nextLayers.length; i++) {
        const prevLayer = prevLayers[i];
        const nextLayer = nextLayers[i];
        if (prevLayer !== nextLayer) {
          const changes = computeLayerDiff(prevLayer, nextLayer);
          if (changes) {
            modifiedLayers.push({ id: nextLayer.id, changes });
          }
        }
      }
      if (modifiedLayers.length > 0) {
        diff.modifiedLayers = modifiedLayers;
      }
    } else {
      const prevLayerMap = new Map<string, CanvasLayer>();
      for (let i = 0; i < prevLayers.length; i++) {
        prevLayerMap.set(prevLayers[i].id, prevLayers[i]);
      }

      const nextLayerMap = new Map<string, CanvasLayer>();
      for (let i = 0; i < nextLayers.length; i++) {
        nextLayerMap.set(nextLayers[i].id, nextLayers[i]);
      }

      const addedLayers: CanvasLayer[] = [];
      for (let i = 0; i < nextLayers.length; i++) {
        const layer = nextLayers[i];
        if (!prevLayerMap.has(layer.id)) {
          addedLayers.push(layer);
        }
      }
      if (addedLayers.length > 0) {
        diff.addedLayers = addedLayers;
      }

      const removedLayerIds: string[] = [];
      for (let i = 0; i < prevLayers.length; i++) {
        const layer = prevLayers[i];
        if (!nextLayerMap.has(layer.id)) {
          removedLayerIds.push(layer.id);
        }
      }
      if (removedLayerIds.length > 0) {
        diff.removedLayerIds = removedLayerIds;
      }

      const modifiedLayers: LayerPatch[] = [];
      for (let i = 0; i < nextLayers.length; i++) {
        const nextLayer = nextLayers[i];
        const prevLayer = prevLayerMap.get(nextLayer.id);
        if (prevLayer && prevLayer !== nextLayer) {
          const changes = computeLayerDiff(prevLayer, nextLayer);
          if (changes) {
            modifiedLayers.push({ id: nextLayer.id, changes });
          }
        }
      }
      if (modifiedLayers.length > 0) {
        diff.modifiedLayers = modifiedLayers;
      }

      let orderChanged = prevLayers.length !== nextLayers.length;
      if (!orderChanged) {
        for (let i = 0; i < prevLayers.length; i++) {
          if (prevLayers[i].id !== nextLayers[i].id) {
            orderChanged = true;
            break;
          }
        }
      }
      if (orderChanged) {
        diff.layerOrder = nextLayers.map((l) => l.id);
      }
    }
  }

  return diff;
}

export function applyDocumentDiff(base: CanvasDocument, diff: CanvasDiff): CanvasDocument {
  if (!diff || Object.keys(diff).length === 0) {
    return base;
  }

  const doc: CanvasDocument = {
    ...base,
    ...(diff.docPatch || {}),
    layers: base.layers,
  };

  const removedSet = new Set(diff.removedLayerIds || []);

  const modifiedMap = new Map<string, Partial<CanvasLayer>>();
  if (diff.modifiedLayers) {
    for (const patch of diff.modifiedLayers) {
      modifiedMap.set(patch.id, patch.changes);
    }
  }

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

  if (diff.addedLayers) {
    for (const added of diff.addedLayers) {
      layerMap.set(added.id, added);
    }
  }

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
    for (const layer of layerMap.values()) {
      finalLayers.push(layer);
    }
  } else {
    finalLayers = Array.from(layerMap.values());
  }

  doc.layers = finalLayers;
  return doc;
}
