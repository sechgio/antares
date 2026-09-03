import type { CanvasDocument, CanvasLayer } from '../types';
import { DOCUMENT_VERSION, mm, newId } from '../types';

export function getPageCount(doc: CanvasDocument): number {
  if (doc.pages?.length) return doc.pages.length;
  const indices = doc.layers.map((l) => l.pageIndex ?? 0);
  return indices.length ? Math.max(...indices) + 1 : 1;
}

export function getActivePageLayers(doc: CanvasDocument, pageIndex: number): CanvasLayer[] {
  return doc.layers.filter((l) => (l.pageIndex ?? 0) === pageIndex);
}

export function indexLayersByPage(layers: readonly CanvasLayer[]): Map<number, CanvasLayer[]> {
  const index = new Map<number, CanvasLayer[]>();
  for (const layer of layers) {
    const pageIndex = layer.pageIndex ?? 0;
    const pageLayers = index.get(pageIndex);
    if (pageLayers) pageLayers.push(layer);
    else index.set(pageIndex, [layer]);
  }
  return index;
}

export function addPage(doc: CanvasDocument): CanvasDocument {
  const nextIndex = getPageCount(doc);
  const pageId = newId();
  const pages = [...(doc.pages ?? [{ id: newId(), name: 'Página 1' }]), { id: pageId, name: `Página ${nextIndex + 1}` }];
  const frame: CanvasLayer = {
    id: newId(),
    type: 'frame',
    name: `Página ${nextIndex + 1}`,
    value: '',
    locked: true,
    pageIndex: nextIndex,
    cssVars: {
      '--width': mm(doc.page.widthMm),
      '--height': mm(doc.page.heightMm),
      '--translate-x': '0mm',
      '--translate-y': '0mm',
      '--background-color': '#ffffff',
    },
  };
  return {
    ...doc,
    version: DOCUMENT_VERSION,
    pages,
    layers: [...doc.layers, frame],
  };
}

export function removePage(doc: CanvasDocument, pageIndex: number): CanvasDocument {
  if (getPageCount(doc) <= 1) return doc;
  const pages = (doc.pages ?? []).filter((_, index) => index !== pageIndex);
  const layers = doc.layers
    .filter((layer) => (layer.pageIndex ?? 0) !== pageIndex)
    .map((layer) => {
      const current = layer.pageIndex ?? 0;
      if (current > pageIndex) return { ...layer, pageIndex: current - 1 };
      return layer;
    });
  const guides = (doc.guides ?? [])
    .filter((guide) => (guide.pageIndex ?? 0) !== pageIndex)
    .map((guide) => {
      const current = guide.pageIndex ?? 0;
      if (current > pageIndex) return { ...guide, pageIndex: current - 1 };
      return guide;
    });
  return { ...doc, pages, layers, guides };
}

function ensurePages(doc: CanvasDocument): Array<{ id: string; name: string }> {
  if (doc.pages?.length) return [...doc.pages];
  return Array.from({ length: getPageCount(doc) }, (_, i) => ({
    id: newId(),
    name: `Página ${i + 1}`,
  }));
}

export function duplicatePage(doc: CanvasDocument, pageIndex: number): CanvasDocument {
  const count = getPageCount(doc);
  if (pageIndex < 0 || pageIndex >= count) return doc;
  const pages = ensurePages(doc);
  const source = pages[pageIndex];
  const copyName = `${source.name} copia`;
  const newPage = { id: newId(), name: copyName };
  pages.splice(pageIndex + 1, 0, newPage);

  const pageLayers = doc.layers.filter((layer) => (layer.pageIndex ?? 0) === pageIndex);
  const idMap = new Map<string, string>();
  for (const layer of pageLayers) {
    idMap.set(layer.id, newId());
  }

  const layers = doc.layers.flatMap((layer) => {
    const idx = layer.pageIndex ?? 0;
    if (idx > pageIndex) return [{ ...layer, pageIndex: idx + 1 }];
    if (idx === pageIndex) {
      const newParent =
        layer.parentId && idMap.has(layer.parentId) ? idMap.get(layer.parentId) : layer.parentId;
      return [
        layer,
        {
          ...layer,
          id: idMap.get(layer.id)!,
          pageIndex: pageIndex + 1,
          name: layer.type === 'frame' ? copyName : layer.name,
          parentId: newParent,
        },
      ];
    }
    return [layer];
  });

  const sourceGuides = (doc.guides ?? []).filter((guide) => (guide.pageIndex ?? 0) === pageIndex);
  const guides = [
    ...(doc.guides ?? []).map((guide) => {
      const idx = guide.pageIndex ?? 0;
      if (idx > pageIndex) return { ...guide, pageIndex: idx + 1 };
      return guide;
    }),
    ...sourceGuides.map((guide) => ({
      ...guide,
      id: newId(),
      pageIndex: pageIndex + 1,
    })),
  ];

  return { ...doc, version: DOCUMENT_VERSION, pages, layers, guides };
}

export function renamePage(doc: CanvasDocument, pageIndex: number, name: string): CanvasDocument {
  const count = getPageCount(doc);
  if (pageIndex < 0 || pageIndex >= count) return doc;
  const trimmed = name.trim() || `Página ${pageIndex + 1}`;
  const pages = ensurePages(doc).map((page, index) =>
    index === pageIndex ? { ...page, name: trimmed } : page,
  );
  const layers = doc.layers.map((layer) => {
    if ((layer.pageIndex ?? 0) === pageIndex && layer.type === 'frame') {
      return { ...layer, name: trimmed };
    }
    return layer;
  });
  return { ...doc, version: DOCUMENT_VERSION, pages, layers };
}

function withPageIndex(layer: CanvasLayer, pageIndex: number): CanvasLayer {
  return (layer.pageIndex ?? 0) === pageIndex ? layer : { ...layer, pageIndex };
}

export function setActivePageLayers(
  doc: CanvasDocument,
  pageIndex: number,
  layers: CanvasLayer[],
): CanvasDocument {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const result: CanvasLayer[] = [];
  const placed = new Set<string>();
  let lastActiveIdx = -1;
  let mutated = false;
  for (const layer of doc.layers) {
    if ((layer.pageIndex ?? 0) !== pageIndex) {
      result.push(layer);
      continue;
    }
    const next = byId.get(layer.id);
    if (next) {
      const stamped = withPageIndex(next, pageIndex);
      if (stamped !== layer) mutated = true;
      result.push(stamped);
      placed.add(layer.id);
      lastActiveIdx = result.length - 1;
    } else {
      mutated = true;
    }
  }
  const newLayers: CanvasLayer[] = [];
  for (const layer of layers) {
    if (!placed.has(layer.id)) {
      newLayers.push(withPageIndex(layer, pageIndex));
      mutated = true;
    }
  }
  if (newLayers.length) {
    result.splice(lastActiveIdx + 1, 0, ...newLayers);
  }
  if (!mutated && result.length === doc.layers.length) {
    let same = true;
    for (let i = 0; i < result.length; i++) {
      if (result[i] !== doc.layers[i]) {
        same = false;
        break;
      }
    }
    if (same) return doc;
  }
  return { ...doc, layers: result };
}

export function templateImagesPerPage(doc: CanvasDocument): number {
  const byPage = new Map<number, number>();
  for (const layer of doc.layers) {
    if (layer.type !== 'imageSlot') continue;
    const page = layer.pageIndex ?? 0;
    byPage.set(page, (byPage.get(page) ?? 0) + 1);
  }
  if (byPage.size === 0) {
    const fallback = doc.settings?.imagesPerPage;
    return fallback && fallback > 0 ? fallback : 1;
  }
  const firstSlotPage = Math.min(...byPage.keys());
  return byPage.get(firstSlotPage) ?? 1;
}

export function syncImagesPerPage(doc: CanvasDocument): CanvasDocument {
  const n = templateImagesPerPage(doc);
  if (doc.settings?.imagesPerPage === n) return doc;
  return {
    ...doc,
    settings: { ...doc.settings, imagesPerPage: n },
  };
}

