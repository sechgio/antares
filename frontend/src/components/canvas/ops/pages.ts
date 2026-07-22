import type { FillContext } from '../runtime/renderHtml';
import { mergeCanvasHtmlDocuments, renderCanvasHtml } from '../runtime/renderHtml';
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
  return { ...doc, pages, layers };
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

  const layers = doc.layers.flatMap((layer) => {
    const idx = layer.pageIndex ?? 0;
    if (idx > pageIndex) return [{ ...layer, pageIndex: idx + 1 }];
    if (idx === pageIndex) {
      return [
        layer,
        {
          ...layer,
          id: newId(),
          pageIndex: pageIndex + 1,
          name: layer.type === 'frame' ? copyName : layer.name,
        },
      ];
    }
    return [layer];
  });

  return { ...doc, version: DOCUMENT_VERSION, pages, layers };
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

export function setActivePageLayers(
  doc: CanvasDocument,
  pageIndex: number,
  layers: CanvasLayer[],
): CanvasDocument {
  const otherPages = doc.layers.filter((layer) => (layer.pageIndex ?? 0) !== pageIndex);
  const normalized = layers.map((layer) => ({ ...layer, pageIndex }));
  return { ...doc, layers: [...otherPages, ...normalized] };
}

export function chunkImages(images: string[], perPage: number): string[][] {
  if (perPage <= 0) return images.length ? [images] : [[]];
  const chunks: string[][] = [];
  for (let i = 0; i < images.length; i += perPage) {
    chunks.push(images.slice(i, i + perPage));
  }
  return chunks.length ? chunks : [[]];
}

export function renderMultiPageHtml(
  doc: CanvasDocument,
  ctx: FillContext,
  options?: { imagesPerPage?: number },
): string {
  const configured = options?.imagesPerPage ?? doc.settings?.imagesPerPage;
  const slotCount = doc.layers.filter((l) => l.type === 'imageSlot').length;
  const perPage = configured && configured > 0 ? configured : Math.max(slotCount, ctx.images.length, 1);
  const imageChunks = chunkImages(ctx.images, perPage);
  const docPageCount = getPageCount(doc);
  // Paginate by image chunks when more images than one page of slots; else use design pages
  const useImagePagination = configured && configured > 0 && ctx.images.length > perPage;
  const totalPages = useImagePagination
    ? Math.max(docPageCount, imageChunks.length)
    : docPageCount;

  const rendered = Array.from({ length: totalPages }, (_, pageIndex) => {
    const sourcePage = Math.min(pageIndex, docPageCount - 1);
    const pageDoc: CanvasDocument = {
      ...doc,
      layers: getActivePageLayers(doc, sourcePage),
    };
    const pageCtx: FillContext = {
      ...ctx,
      images: useImagePagination ? (imageChunks[pageIndex] ?? []) : ctx.images,
    };
    return renderCanvasHtml(pageDoc, pageCtx);
  });

  return mergeCanvasHtmlDocuments(rendered);
}
