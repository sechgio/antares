import type {
  CanvasDocument,
  CanvasLayer,
  CanvasStyleKind,
  LayerCssVars,
} from '../types';
import { pickStyleVars, styleIdField, updateStyle } from './sharedStyles';

function stylePatchEqual(a: Partial<LayerCssVars>, b: Partial<LayerCssVars>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

const STYLE_KINDS: CanvasStyleKind[] = ['color', 'text', 'effect'];

export function syncLinkedStylesFromLayer(
  doc: CanvasDocument,
  prev: CanvasLayer | undefined,
  next: CanvasLayer,
): CanvasDocument {
  if (!prev) return doc;
  let out = doc;
  for (const kind of STYLE_KINDS) {
    const field = styleIdField(kind);
    const styleId = next[field];
    if (!styleId) continue;
    const nextPatch = pickStyleVars(next.cssVars, kind);
    const prevPatch = pickStyleVars(prev.cssVars, kind);
    if (stylePatchEqual(nextPatch, prevPatch)) continue;
    out = updateStyle(out, styleId, { cssVars: nextPatch });
  }
  return out;
}
