import type { CanvasLayer, LayerCssVars } from '../types';

type VariantCatalog = Record<string, Partial<LayerCssVars>>;

export type PreparedVariant = {
  key: string;
  patch: Partial<LayerCssVars>;
  parsedEntries: Array<[string, string]>;
  parsedMap: Map<string, string>;
};

export type VariantIndex = {
  entries: PreparedVariant[];
  byLiteral: Map<string, PreparedVariant>;
  byCanonical: Map<string, PreparedVariant>;
};

export interface ResolvedVariant {
  matchedKey?: string;
  patch: Partial<LayerCssVars>;
  resolvedProps?: Record<string, string>;
}

const variantIndexCache = new WeakMap<VariantCatalog, VariantIndex>();

export function canonicalVariantKey(props: Record<string, string>): string {
  const entries = Object.entries(props)
    .map(
      ([key, value]) =>
        [key.trim().toLowerCase(), String(value ?? '').trim().toLowerCase()] as [string, string],
    )
    .filter(([key, value]) => key.length > 0 && value.length > 0)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
      return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    });
  return entries.map(([key, value]) => `${key}=${value}`).join(', ');
}

export function parseVariantKey(key: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!key) return result;

  for (const part of key.split(/[,;]/)) {
    const separatorIndex = part.indexOf('=');
    const name = part.slice(0, separatorIndex >= 0 ? separatorIndex : undefined).trim();
    if (!name) continue;
    result[name] = separatorIndex >= 0 ? part.slice(separatorIndex + 1).trim() : 'true';
  }
  return result;
}

export function prepareVariantIndex(variants: VariantCatalog): VariantIndex {
  const cached = variantIndexCache.get(variants);
  if (cached) return cached;

  const index: VariantIndex = {
    entries: [],
    byLiteral: new Map(),
    byCanonical: new Map(),
  };

  for (const [key, patch] of Object.entries(variants)) {
    const parsed = parseVariantKey(key);
    const canonical = canonicalVariantKey(parsed);
    const parsedEntries = Object.entries(parsed).map(
      ([name, value]) => [name.toLowerCase(), value.toLowerCase()] as [string, string],
    );
    const prepared: PreparedVariant = {
      key,
      patch: patch ?? {},
      parsedEntries,
      parsedMap: new Map(parsedEntries),
    };
    index.entries.push(prepared);
    index.byLiteral.set(key, prepared);
    if (!index.byCanonical.has(canonical)) index.byCanonical.set(canonical, prepared);
  }

  variantIndexCache.set(variants, index);
  return index;
}

function mappedVariantValue(
  mapping: Record<string, string> | undefined,
  value: string,
): string | undefined {
  if (!mapping) return undefined;
  if (Object.prototype.hasOwnProperty.call(mapping, value)) return mapping[value];
  const normalized = value.toLowerCase();
  return Object.entries(mapping).find(([key]) => key.trim().toLowerCase() === normalized)?.[1];
}

export function resolveVariantFromBinding(
  meta: CanvasLayer['meta'] | undefined,
  data?: Record<string, unknown>,
): {
  boundVariant?: string;
  boundProps?: Record<string, string>;
} {
  if (!meta?.variantBinding || !data) return {};
  const binding = meta.variantBinding;
  let boundVariant: string | undefined;
  const boundProps: Record<string, string> = {};

  if (binding.fieldKey) {
    const rawValue = data[binding.fieldKey];
    if (rawValue != null && rawValue !== '') {
      const value = String(rawValue).trim();
      boundVariant = mappedVariantValue(binding.mapping, value) ?? value;
    } else if (binding.fallbackVariant) {
      boundVariant = binding.fallbackVariant;
    }
  }

  if (binding.propBindings) {
    for (const [propName, propDefinition] of Object.entries(binding.propBindings)) {
      const rawValue = data[propDefinition.fieldKey];
      if (rawValue != null && rawValue !== '') {
        const value = String(rawValue).trim();
        boundProps[propName] = mappedVariantValue(propDefinition.mapping, value) ?? value;
      } else if (propDefinition.fallback) {
        boundProps[propName] = propDefinition.fallback;
      }
    }
  }

  return {
    boundVariant,
    boundProps: Object.keys(boundProps).length > 0 ? boundProps : undefined,
  };
}

export function resolveVariantPatch(
  master: CanvasLayer,
  variantOrInstance?: string | CanvasLayer,
  variantProps?: Record<string, string>,
  data?: Record<string, unknown>,
  metaOverride?: CanvasLayer['meta'],
): ResolvedVariant {
  const instance =
    typeof variantOrInstance === 'object' && variantOrInstance !== null
      ? variantOrInstance
      : undefined;
  const instanceMeta = instance?.meta ?? metaOverride;
  const baseVariant = instance
    ? instance.meta?.variant
    : typeof variantOrInstance === 'string'
      ? variantOrInstance
      : undefined;
  const baseProps = { ...instance?.meta?.variantProps, ...variantProps };
  const { boundVariant, boundProps } = resolveVariantFromBinding(instanceMeta, data);
  const effectiveVariant = boundVariant ?? baseVariant;
  const effectiveProps: Record<string, string> = { ...baseProps, ...boundProps };

  if (effectiveVariant?.includes('=')) {
    for (const [key, value] of Object.entries(parseVariantKey(effectiveVariant))) {
      effectiveProps[key] ??= value;
    }
  }

  const hasProps = Object.keys(effectiveProps).length > 0;
  const resolvedProps = hasProps ? effectiveProps : undefined;
  const variants = master.meta?.variants;
  if (!variants) return { patch: {}, resolvedProps };

  const variantIndex = prepareVariantIndex(variants);
  if (variantIndex.entries.length === 0) return { patch: {}, resolvedProps };

  const directMatch = effectiveVariant ? variantIndex.byLiteral.get(effectiveVariant) : undefined;
  if (directMatch) {
    return { matchedKey: directMatch.key, patch: directMatch.patch, resolvedProps };
  }

  if (hasProps) {
    const canonical = canonicalVariantKey(effectiveProps);
    const canonicalMatch = variantIndex.byCanonical.get(canonical);
    if (canonicalMatch) {
      return { matchedKey: canonicalMatch.key, patch: canonicalMatch.patch, resolvedProps };
    }

    const targetEntries = Object.entries(effectiveProps).map(
      ([key, value]) => [key.toLowerCase(), value.toLowerCase()] as const,
    );
    let bestMatch: PreparedVariant | undefined;
    let bestScore = -1;
    let bestDifference = Infinity;

    for (const variant of variantIndex.entries) {
      const score = targetEntries.reduce((total, [key, value]) => {
        if (variant.parsedMap.get(key) === value) return total + 2;
        return total + (variant.parsedMap.has(key) ? 0.5 : 0);
      }, 0);
      const difference = Math.abs(variant.parsedEntries.length - targetEntries.length);
      if (score > bestScore || (score === bestScore && difference < bestDifference)) {
        bestMatch = variant;
        bestScore = score;
        bestDifference = difference;
      }
    }

    if (bestMatch && bestScore > 0) {
      return { matchedKey: bestMatch.key, patch: bestMatch.patch, resolvedProps };
    }
  }

  const fallback = instanceMeta?.variantBinding?.fallbackVariant;
  const fallbackMatch = fallback ? variantIndex.byLiteral.get(fallback) : undefined;
  if (fallbackMatch) {
    return { matchedKey: fallbackMatch.key, patch: fallbackMatch.patch, resolvedProps };
  }

  return { patch: {}, resolvedProps };
}

export function masterBaseCssVars(
  master: CanvasLayer,
  variantOrInstance?: string | CanvasLayer,
  variantProps?: Record<string, string>,
  data?: Record<string, unknown>,
): LayerCssVars {
  return {
    ...master.cssVars,
    ...resolveVariantPatch(master, variantOrInstance, variantProps, data).patch,
  } as LayerCssVars;
}
