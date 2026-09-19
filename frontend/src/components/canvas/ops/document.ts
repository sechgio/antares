import type { CanvasDocument, CanvasLayer, LayerMeta, LayerPath } from '../types';

function clonePath(path: LayerPath): LayerPath {
  return {
    closed: path.closed,
    points: path.points.map((p) => ({
      ...p,
      hin: p.hin ? { ...p.hin } : p.hin,
      hout: p.hout ? { ...p.hout } : p.hout,
    })),
  };
}

function cloneMeta(meta: LayerMeta): LayerMeta {
  return {
    ...meta,
    colTracks: meta.colTracks ? [...meta.colTracks] : undefined,
    rowTracks: meta.rowTracks ? [...meta.rowTracks] : undefined,
    rules: meta.rules ? meta.rules.map((r) => ({ ...r })) : undefined,
    path: meta.path ? clonePath(meta.path) : undefined,
  };
}

function cloneLayer(l: CanvasLayer): CanvasLayer {
  return {
    ...l,
    cssVars: { ...l.cssVars },
    meta: l.meta ? cloneMeta(l.meta) : undefined,
  };
}

function cloneDocumentWith(doc: CanvasDocument, mapLayer: (layer: CanvasLayer) => CanvasLayer) {
  return {
    ...doc,
    page: { ...doc.page },
    layers: doc.layers.map(mapLayer),
    fields: doc.fields.map((f) => ({ ...f })),
    pages: doc.pages?.map((p) => ({ ...p })),
    settings: doc.settings
      ? { ...doc.settings, gridRules: doc.settings.gridRules?.map((r) => ({ ...r })) }
      : undefined,
    styles: doc.styles?.map((s) => ({ ...s, cssVars: { ...s.cssVars } })),
    guides: doc.guides?.map((g) => ({ ...g })),
  };
}

export function cloneDocument(doc: CanvasDocument): CanvasDocument {
  return cloneDocumentWith(doc, cloneLayer);
}

export function cloneDocumentBaseline(doc: CanvasDocument, pageIndex: number): CanvasDocument {
  return cloneDocumentWith(doc, (l) => ((l.pageIndex ?? 0) === pageIndex ? cloneLayer(l) : l));
}
