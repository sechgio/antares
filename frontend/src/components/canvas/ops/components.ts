import type { CanvasDocument, CanvasLayer, LayerCssVars } from '../types';
import { mm, newId, parseMm } from '../types';
import { expandWithDescendants } from './layerTree';
import { masterBaseCssVars, resolveVariantPatch } from './variants';

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
  variantOrOptions?: string | { variant?: string; variantProps?: Record<string, string> },
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

  const initialVariant =
    typeof variantOrOptions === 'string' ? variantOrOptions : variantOrOptions?.variant;
  const initialProps =
    typeof variantOrOptions === 'object' ? variantOrOptions.variantProps : undefined;

  const patch = resolveVariantPatch(master, initialVariant, initialProps).patch;

  const resolved = {
    ...master.cssVars,
    ...patch,
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
      ...(initialVariant ? { variant: initialVariant } : {}),
      ...(initialProps ? { variantProps: initialProps } : {}),
    },
  };

  const descendantIds = expandWithDescendants(doc.layers, [master.id]);
  const idMap = new Map(descendantIds.map((id) => [id, id === master.id ? instanceId : newId()]));
  const childLayers = doc.layers
    .filter((layer) => layer.id !== master.id && idMap.has(layer.id))
    .map((layer): CanvasLayer => ({
      ...layer,
      id: idMap.get(layer.id)!,
      parentId: layer.parentId ? idMap.get(layer.parentId) ?? layer.parentId : undefined,
    }));

  return { instance, childLayers };
}

export function applyInstanceOverrides(
  instance: CanvasLayer,
  master: CanvasLayer | undefined,
  data?: Record<string, unknown>,
): LayerCssVars {
  const overrides = instance.meta?.overrideVars ?? {};
  if (!master) {
    return { ...instance.cssVars, ...overrides } as LayerCssVars;
  }
  const { patch } = resolveVariantPatch(master, instance, undefined, data);
  return {
    ...master.cssVars,
    ...patch,
    ...overrides,
  } as LayerCssVars;
}

export function bakeInstanceOverrides(
  instance: CanvasLayer,
  master: CanvasLayer | undefined,
  data?: Record<string, unknown>,
): CanvasLayer {
  if (!instance.meta?.instanceOf) return instance;
  const base = master
    ? masterBaseCssVars(master, instance, undefined, data)
    : ({} as LayerCssVars);
  const overrideVars: Partial<LayerCssVars> = {};
  for (const [key, value] of Object.entries(instance.cssVars)) {
    if (value === undefined) continue;
    if (value !== base[key]) overrideVars[key] = value;
  }
  const prevOverrides = instance.meta.overrideVars ?? {};
  if (cssVarsEqual(prevOverrides, overrideVars)) {
    const resolved = applyInstanceOverrides(instance, master, data);
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
    cssVars: applyInstanceOverrides({ ...instance, meta }, master, data),
  };
}

export function bakeAllInstances(doc: CanvasDocument, data?: Record<string, unknown>): CanvasDocument {
  let changed = false;
  const layers = doc.layers.map((layer) => {
    if (!layer.meta?.instanceOf) return layer;
    const master = findComponentMaster(doc.layers, layer.meta.instanceOf);
    const next = bakeInstanceOverrides(layer, master, data);
    if (next !== layer) changed = true;
    return next;
  });
  return changed ? { ...doc, layers } : doc;
}

export function syncComponentToInstances(
  doc: CanvasDocument,
  masterId: string,
  nextMaster: CanvasLayer,
  data?: Record<string, unknown>,
): CanvasDocument {
  let changed = false;
  const layers = doc.layers.map((layer) => {
    if (layer.meta?.instanceOf !== masterId) return layer;
    const nextCss = applyInstanceOverrides(layer, nextMaster, data);
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
  data?: Record<string, unknown>,
): CanvasDocument {
  if (next.meta?.instanceOf) return doc;
  const masterId = next.meta?.componentId;
  if (!masterId) return doc;
  if (prev && cssVarsEqual(prev.cssVars, next.cssVars) && variantsEqual(prev.meta?.variants, next.meta?.variants)) {
    return doc;
  }
  return syncComponentToInstances(doc, masterId, next, data);
}

export function syncChangedMasters(
  doc: CanvasDocument,
  baseline: CanvasDocument | undefined,
  data?: Record<string, unknown>,
): CanvasDocument {
  let out = doc;
  for (const layer of doc.layers) {
    if (!layer.meta?.componentId || layer.meta.instanceOf) continue;
    const prev = baseline?.layers.find((l) => l.id === layer.id);
    out = syncComponentFromLayer(out, prev, layer, data);
  }
  return out;
}

export function resetInstanceOverrides(
  instance: CanvasLayer,
  master: CanvasLayer | undefined,
  data?: Record<string, unknown>,
): CanvasLayer {
  if (!instance.meta?.instanceOf) return instance;
  const meta = { ...instance.meta, overrideVars: undefined };
  return {
    ...instance,
    meta,
    cssVars: applyInstanceOverrides({ ...instance, meta }, master, data),
  };
}

export function detachInstance(instance: CanvasLayer): CanvasLayer {
  if (!instance.meta?.instanceOf) return instance;
  const meta = { ...instance.meta };
  delete meta.instanceOf;
  delete meta.overrideVars;
  delete meta.variant;
  delete meta.variantProps;
  delete meta.variantBinding;
  return {
    ...instance,
    type: 'group',
    name: instance.name.replace(/ instancia$/, ''),
    meta,
  };
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
