import type { CanvasDocument, CanvasLayer } from '../types';

function cloneLayer(l: CanvasLayer): CanvasLayer {
  return {
    ...l,
    cssVars: { ...l.cssVars },
    meta: l.meta ? { ...l.meta } : undefined,
  };
}

/** Deep-clone a document for gesture/edit baselines (independent undo entry).
 *  Shallow-clones the doc, page, settings; deep-clones layers (with cssVars + meta),
 *  fields, pages, and grid rules. */
export function cloneDocument(doc: CanvasDocument): CanvasDocument {
  return {
    ...doc,
    page: { ...doc.page },
    layers: doc.layers.map(cloneLayer),
    fields: doc.fields.map((f) => ({ ...f })),
    pages: doc.pages?.map((p) => ({ ...p })),
    settings: doc.settings
      ? { ...doc.settings, gridRules: doc.settings.gridRules?.map((r) => ({ ...r })) }
      : undefined,
    styles: doc.styles?.map((s) => ({ ...s, cssVars: { ...s.cssVars } })),
    guides: doc.guides?.map((g) => ({ ...g })),
  };
}

/**
 * Baseline clone for a single-page edit: deep-clones layers on `pageIndex`,
 * shares refs for other pages (structural sharing). Cuts history RAM on multi-page docs.
 */
export function cloneDocumentBaseline(doc: CanvasDocument, pageIndex: number): CanvasDocument {
  return {
    ...doc,
    page: { ...doc.page },
    layers: doc.layers.map((l) => ((l.pageIndex ?? 0) === pageIndex ? cloneLayer(l) : l)),
    fields: doc.fields.map((f) => ({ ...f })),
    pages: doc.pages?.map((p) => ({ ...p })),
    settings: doc.settings
      ? { ...doc.settings, gridRules: doc.settings.gridRules?.map((r) => ({ ...r })) }
      : undefined,
    styles: doc.styles?.map((s) => ({ ...s, cssVars: { ...s.cssVars } })),
    guides: doc.guides?.map((g) => ({ ...g })),
  };
}
