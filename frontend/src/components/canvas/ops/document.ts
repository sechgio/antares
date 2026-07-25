import type { CanvasDocument, CanvasLayer } from '../types';

/** Deep-clone a document for gesture/edit baselines (independent undo entry).
 *  Shallow-clones the doc, page, settings; deep-clones layers (with cssVars + meta),
 *  fields, pages, and grid rules. */
export function cloneDocument(doc: CanvasDocument): CanvasDocument {
  return {
    ...doc,
    page: { ...doc.page },
    layers: doc.layers.map((l): CanvasLayer => ({
      ...l,
      cssVars: { ...l.cssVars },
      meta: l.meta ? { ...l.meta } : undefined,
    })),
    fields: doc.fields.map((f) => ({ ...f })),
    pages: doc.pages?.map((p) => ({ ...p })),
    settings: doc.settings
      ? { ...doc.settings, gridRules: doc.settings.gridRules?.map((r) => ({ ...r })) }
      : undefined,
  };
}
