import type {
  CanvasDocument,
  CanvasLayer,
  CanvasSharedStyle,
  CanvasStyleKind,
  LayerCssVars,
} from '../types';
import { newId } from '../types';

/** Fill / stroke keys belonging to a shared color style. */
export const COLOR_STYLE_KEYS = [
  '--background-color',
  '--fill-type',
  '--fill-color-2',
  '--fill-angle',
  '--fill-opacity',
  '--fill-visible',
  '--border-color',
  '--border-width',
  '--border',
  '--stroke-dash',
  '--stroke-opacity',
  '--stroke-visible',
  '--stroke-align',
  '--stroke-start',
  '--stroke-end',
] as const;

/** Typography keys belonging to a shared text style. */
export const TEXT_STYLE_KEYS = [
  '--color',
  '--font-family',
  '--font-size',
  '--font-weight',
  '--font-style',
  '--text-decoration',
  '--letter-spacing',
  '--text-align',
  '--text-valign',
  '--text-transform',
] as const;

/** Effect keys belonging to a shared effect style. */
export const EFFECT_STYLE_KEYS = ['--box-shadow', '--filter-blur'] as const;

const KEYS_BY_KIND: Record<CanvasStyleKind, readonly string[]> = {
  color: COLOR_STYLE_KEYS,
  text: TEXT_STYLE_KEYS,
  effect: EFFECT_STYLE_KEYS,
};

export function styleIdField(kind: CanvasStyleKind): 'fillStyleId' | 'textStyleId' | 'effectStyleId' {
  if (kind === 'color') return 'fillStyleId';
  if (kind === 'text') return 'textStyleId';
  return 'effectStyleId';
}

export function pickStyleVars(
  cssVars: LayerCssVars | Partial<LayerCssVars>,
  kind: CanvasStyleKind,
): Partial<LayerCssVars> {
  const out: Partial<LayerCssVars> = {};
  for (const key of KEYS_BY_KIND[kind]) {
    const value = cssVars[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function stylesOfKind(doc: CanvasDocument, kind: CanvasStyleKind): CanvasSharedStyle[] {
  return (doc.styles ?? []).filter((s) => s.kind === kind);
}

function defaultStyleName(kind: CanvasStyleKind, layer: CanvasLayer): string {
  const base = layer.name?.trim() || kind;
  if (kind === 'color') return `Color · ${base}`;
  if (kind === 'text') return `Texto · ${base}`;
  return `Efecto · ${base}`;
}

/** Extract a new shared style from a layer's current cssVars. */
export function createStyleFromLayer(layer: CanvasLayer, kind: CanvasStyleKind): CanvasSharedStyle {
  return {
    id: newId(),
    name: defaultStyleName(kind, layer),
    kind,
    cssVars: pickStyleVars(layer.cssVars, kind),
  };
}

function withStyleLink(layer: CanvasLayer, style: CanvasSharedStyle): CanvasLayer {
  const field = styleIdField(style.kind);
  const patch = pickStyleVars(style.cssVars, style.kind);
  return {
    ...layer,
    [field]: style.id,
    cssVars: { ...layer.cssVars, ...patch },
  };
}

/** Apply a shared style to selected layers (writes cssVars + sets *StyleId). */
export function applyStyleToLayers(
  layers: CanvasLayer[],
  style: CanvasSharedStyle,
  ids: string[],
): CanvasLayer[] {
  if (!ids.length) return layers;
  const idSet = new Set(ids);
  return layers.map((layer) => {
    if (!idSet.has(layer.id) || layer.type === 'frame' || layer.locked) return layer;
    return withStyleLink(layer, style);
  });
}

/** Remove style link; keep baked cssVars. */
export function detachStyle(layer: CanvasLayer, kind: CanvasStyleKind): CanvasLayer {
  const field = styleIdField(kind);
  if (!layer[field]) return layer;
  const next = { ...layer };
  delete next[field];
  return next;
}

export function detachStyleOnLayers(
  layers: CanvasLayer[],
  kind: CanvasStyleKind,
  ids: string[],
): CanvasLayer[] {
  const idSet = new Set(ids);
  return layers.map((layer) => (idSet.has(layer.id) ? detachStyle(layer, kind) : layer));
}

/**
 * Update a style definition and push its vars to every linked layer.
 * Unlinked layers are untouched.
 */
export function updateStyle(
  doc: CanvasDocument,
  styleId: string,
  patch: { name?: string; cssVars?: Partial<LayerCssVars> },
): CanvasDocument {
  const styles = doc.styles ?? [];
  const index = styles.findIndex((s) => s.id === styleId);
  if (index < 0) return doc;

  const prev = styles[index]!;
  const nextCss = patch.cssVars
    ? { ...prev.cssVars, ...pickStyleVars(patch.cssVars, prev.kind) }
    : prev.cssVars;
  const nextStyle: CanvasSharedStyle = {
    ...prev,
    name: patch.name?.trim() || prev.name,
    cssVars: nextCss,
  };
  const nextStyles = styles.map((s, i) => (i === index ? nextStyle : s));
  const field = styleIdField(prev.kind);
  const kindPatch = pickStyleVars(nextStyle.cssVars, prev.kind);

  return {
    ...doc,
    styles: nextStyles,
    layers: doc.layers.map((layer) => {
      if (layer[field] !== styleId) return layer;
      return {
        ...layer,
        cssVars: { ...layer.cssVars, ...kindPatch },
      };
    }),
  };
}

/** Add a style to the document catalog (does not apply to layers). */
export function addStyleToDocument(doc: CanvasDocument, style: CanvasSharedStyle): CanvasDocument {
  return { ...doc, styles: [...(doc.styles ?? []), style] };
}

/**
 * Create a style from the layer, add it to the doc, and link the layer.
 * Convenience for “Crear estilo desde selección”.
 */
export function createAndLinkStyle(
  doc: CanvasDocument,
  layerId: string,
  kind: CanvasStyleKind,
): CanvasDocument {
  const layer = doc.layers.find((l) => l.id === layerId);
  if (!layer || layer.type === 'frame') return doc;
  const style = createStyleFromLayer(layer, kind);
  const withStyle = addStyleToDocument(doc, style);
  return {
    ...withStyle,
    layers: applyStyleToLayers(withStyle.layers, style, [layerId]),
  };
}

/** Delete a style from the catalog and detach all linked layers. */
export function removeStyle(doc: CanvasDocument, styleId: string): CanvasDocument {
  const styles = doc.styles ?? [];
  const target = styles.find((s) => s.id === styleId);
  if (!target) return doc;
  const field = styleIdField(target.kind);
  return {
    ...doc,
    styles: styles.filter((s) => s.id !== styleId),
    layers: doc.layers.map((layer) => {
      if (layer[field] !== styleId) return layer;
      const next = { ...layer };
      delete next[field];
      return next;
    }),
  };
}

/** Named color swatches from color styles (for picker append). */
export function colorStyleSwatches(doc: CanvasDocument): Array<{ id: string; name: string; color: string }> {
  return stylesOfKind(doc, 'color')
    .map((s) => {
      const color = s.cssVars['--background-color'] || s.cssVars['--border-color'] || s.cssVars['--color'];
      if (!color || color === 'transparent') return null;
      return { id: s.id, name: s.name, color };
    })
    .filter((x): x is { id: string; name: string; color: string } => x != null);
}
