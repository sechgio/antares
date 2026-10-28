import type {
  CanvasDocument,
  CanvasLayer,
  CanvasStyleKind,
} from '../types';
import { cssVarsEqual, pickStyleVars, styleIdField, updateStyle } from './sharedStyles';

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
    if (cssVarsEqual(nextPatch, prevPatch)) continue;
    out = updateStyle(out, styleId, { cssVars: nextPatch });
  }
  return out;
}
