import type { CanvasDocument, CanvasLayer, LayerCssVars } from '../types';
import { mm, newId, parseMm } from '../types';

export const INSTANCE_OFFSET_MM = 5;

function cssVarsEqual(a: Partial<LayerCssVars>, b: Partial<LayerCssVars>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function variantsEqual(
  a: Record<string, Partial<LayerCssVars>> | undefined,
  b: Record<string, Partial<LayerCssVars>> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!cssVarsEqual(a[key] ?? {}, b[key] ?? {})) return false;
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

export function masterBaseCssVars(master: CanvasLayer, variant?: string): LayerCssVars {
  return {
    ...master.cssVars,
    ...variantPatch(master, variant),
  } as LayerCssVars;
}

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

export function instantiateComponent(
  master: CanvasLayer,
  doc: CanvasDocument,
  overrideVars?: Partial<LayerCssVars>,
  variant?: string,
  options?: { offsetMm?: number },
): { instance: CanvasLayer; childLayers: CanvasLayer[] } {
  const masterId = master.meta?.componentId ?? master.id;
  const instanceId = newId();
  const offset = options?.offsetMm ?? INSTANCE_OFFSET_MM;
  const userOverrides =
    overrideVars && Object.keys(overrideVars).length > 0 ? { ...overrideVars } : {};

  const baseTx = parseMm(userOverrides['--translate-x'] ?? master.cssVars['--translate-x']);
  const baseTy = parseMm(userOverrides['--translate-y'] ?? master.cssVars['--translate-y']);
  const tx = userOverrides['--translate-x'] != null ? baseTx : baseTx + offset;
  const ty = userOverrides['--translate-y'] != null ? baseTy : baseTy + offset;

  const seededOverrides: Partial<LayerCssVars> = {
    ...userOverrides,
    '--translate-x': mm(tx),
    '--translate-y': mm(ty),
  };

  const resolved = {
    ...master.cssVars,
    ...variantPatch(master, variant),
    ...seededOverrides,
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
      overrideVars: seededOverrides,
      ...(variant ? { variant } : {}),
    },
  };

  const idMap = new Map<string, string>();
  idMap.set(master.id, instanceId);

  const masterDescendantIds = new Set<string>([master.id]);
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

export function bakeInstanceOverrides(
  instance: CanvasLayer,
  master: CanvasLayer | undefined,
): CanvasLayer {
  if (!instance.meta?.instanceOf) return instance;
  const base = master
    ? masterBaseCssVars(master, instance.meta.variant)
    : ({} as LayerCssVars);
  const overrideVars: Partial<LayerCssVars> = {};
  for (const [key, value] of Object.entries(instance.cssVars)) {
    if (value === undefined) continue;
    if (value !== base[key]) overrideVars[key] = value;
  }
  const prevOverrides = instance.meta.overrideVars ?? {};
  if (cssVarsEqual(prevOverrides, overrideVars)) {
    const resolved = applyInstanceOverrides(instance, master);
    if (cssVarsEqual(instance.cssVars, resolved)) return instance;
    return { ...instance, cssVars: resolved };
  }
  const meta = { ...instance.meta };
  if (Object.keys(overrideVars).length > 0) {
    meta.overrideVars = overrideVars;
  } else {
    meta.overrideVars = undefined;
  }
  return {
    ...instance,
    meta,
    cssVars: applyInstanceOverrides({ ...instance, meta }, master),
  };
}

export function bakeAllInstances(doc: CanvasDocument): CanvasDocument {
  let changed = false;
  const layers = doc.layers.map((layer) => {
    if (!layer.meta?.instanceOf) return layer;
    const master = findComponentMaster(doc.layers, layer.meta.instanceOf);
    const next = bakeInstanceOverrides(layer, master);
    if (next !== layer) changed = true;
    return next;
  });
  return changed ? { ...doc, layers } : doc;
}

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

export function syncComponentFromLayer(
  doc: CanvasDocument,
  prev: CanvasLayer | undefined,
  next: CanvasLayer,
): CanvasDocument {
  if (next.meta?.instanceOf) return doc;
  const masterId = next.meta?.componentId;
  if (!masterId) return doc;
  if (prev && cssVarsEqual(prev.cssVars, next.cssVars) && variantsEqual(prev.meta?.variants, next.meta?.variants)) {
    return doc;
  }
  return syncComponentToInstances(doc, masterId, next);
}

export function syncChangedMasters(
  doc: CanvasDocument,
  baseline: CanvasDocument | undefined,
): CanvasDocument {
  let out = doc;
  for (const layer of doc.layers) {
    if (!layer.meta?.componentId || layer.meta.instanceOf) continue;
    const prev = baseline?.layers.find((l) => l.id === layer.id);
    out = syncComponentFromLayer(out, prev, layer);
  }
  return out;
}

export function findComponentMaster(
  layers: CanvasLayer[],
  masterId: string,
): CanvasLayer | undefined {
  return (
    layers.find((l) => l.meta?.componentId === masterId && !l.meta?.instanceOf) ??
    layers.find((l) => l.type === 'component' && l.id === masterId && !l.meta?.instanceOf)
  );
}
