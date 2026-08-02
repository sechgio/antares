import type { CanvasDocument, CanvasLayer, LayerCssVars } from '../types';
import { newId } from '../types';

function cssVarsEqual(a: LayerCssVars, b: LayerCssVars): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function variantPatch(
  master: CanvasLayer,
  variant: string | undefined,
): Partial<LayerCssVars> {
  if (!variant) return {};
  const patch = master.meta?.variants?.[variant];
  return patch && typeof patch === 'object' ? patch : {};
}

/** Convert a layer into a component master (same id). Children keep parentId. */
export function createComponentFromLayer(layer: CanvasLayer, _doc: CanvasDocument): CanvasLayer {
  const { instanceOf: _instanceOf, overrideVars: _ov, variant: _v, ...restMeta } = layer.meta ?? {};
  return {
    ...layer,
    type: 'component',
    meta: {
      ...restMeta,
      componentId: layer.id,
    },
  };
}

/**
 * Create an instance of a master component.
 * Returns the root instance plus remapped child copies (parentId rewritten).
 */
export function instantiateComponent(
  master: CanvasLayer,
  doc: CanvasDocument,
  overrideVars?: Partial<LayerCssVars>,
  variant?: string,
): { instance: CanvasLayer; childLayers: CanvasLayer[] } {
  const masterId = master.meta?.componentId ?? master.id;
  const instanceId = newId();
  const overrides = overrideVars && Object.keys(overrideVars).length > 0 ? { ...overrideVars } : undefined;
  const resolved = {
    ...master.cssVars,
    ...variantPatch(master, variant),
    ...overrides,
  } as LayerCssVars;

  const { componentId: _cid, variants: _vars, ...restMeta } = master.meta ?? {};
  const instance: CanvasLayer = {
    ...master,
    id: instanceId,
    type: 'component',
    name: `${master.name} instancia`,
    cssVars: resolved,
    meta: {
      ...restMeta,
      instanceOf: masterId,
      ...(overrides ? { overrideVars: overrides } : {}),
      ...(variant ? { variant } : {}),
    },
  };

  const children = doc.layers.filter((l) => l.parentId === master.id);
  const idMap = new Map<string, string>();
  idMap.set(master.id, instanceId);
  for (const child of children) {
    idMap.set(child.id, newId());
  }

  // Remap nested descendants under the master's subtree.
  const masterDescendantIds = new Set(idMap.keys());
  let grew = true;
  while (grew) {
    grew = false;
    for (const layer of doc.layers) {
      if (!layer.parentId || masterDescendantIds.has(layer.id)) continue;
      if (!masterDescendantIds.has(layer.parentId)) continue;
      masterDescendantIds.add(layer.id);
      idMap.set(layer.id, newId());
      grew = true;
    }
  }

  const childLayers: CanvasLayer[] = [];
  for (const layer of doc.layers) {
    if (layer.id === master.id) continue;
    if (!idMap.has(layer.id)) continue;
    const newParent =
      layer.parentId && idMap.has(layer.parentId) ? idMap.get(layer.parentId) : layer.parentId;
    childLayers.push({
      ...layer,
      id: idMap.get(layer.id)!,
      parentId: newParent,
    });
  }

  return { instance, childLayers };
}

/** Final cssVars for an instance: master (+ variant) merged with overrideVars (override wins). */
export function applyInstanceOverrides(
  instance: CanvasLayer,
  master: CanvasLayer | undefined,
): LayerCssVars {
  const overrides = instance.meta?.overrideVars ?? {};
  if (!master) {
    return { ...instance.cssVars, ...overrides } as LayerCssVars;
  }
  return {
    ...master.cssVars,
    ...variantPatch(master, instance.meta?.variant),
    ...overrides,
  } as LayerCssVars;
}

/**
 * Push master cssVars (and variant patches) to every instance of `masterId`,
 * preserving each instance's overrideVars (same idea as syncLinkedStyles).
 */
export function syncComponentToInstances(
  doc: CanvasDocument,
  masterId: string,
  nextMaster: CanvasLayer,
): CanvasDocument {
  let changed = false;
  const layers = doc.layers.map((layer) => {
    if (layer.meta?.instanceOf !== masterId) return layer;
    const nextCss = applyInstanceOverrides(layer, nextMaster);
    if (cssVarsEqual(layer.cssVars, nextCss)) return layer;
    changed = true;
    return { ...layer, cssVars: nextCss };
  });
  return changed ? { ...doc, layers } : doc;
}

/**
 * After a panel/gesture commit on a master, propagate to instances.
 * No-op when the edit comes from an instance (has instanceOf).
 */
export function syncComponentFromLayer(
  doc: CanvasDocument,
  prev: CanvasLayer | undefined,
  next: CanvasLayer,
): CanvasDocument {
  if (next.meta?.instanceOf) return doc;
  const masterId = next.meta?.componentId;
  if (!masterId) return doc;
  if (prev && cssVarsEqual(prev.cssVars, next.cssVars)) {
    const prevVariants = prev.meta?.variants;
    const nextVariants = next.meta?.variants;
    if (prevVariants === nextVariants) return doc;
  }
  return syncComponentToInstances(doc, masterId, next);
}

/** Find the master layer for an instanceOf id. */
export function findComponentMaster(
  layers: CanvasLayer[],
  masterId: string,
): CanvasLayer | undefined {
  return layers.find(
    (l) => l.meta?.componentId === masterId || (l.type === 'component' && l.id === masterId),
  );
}
