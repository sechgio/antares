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
  // Replace active-page layers in place to preserve document array order.
  // The incoming `layers` is the complete set for this page: existing layers
  // keep their position, removed layers are dropped, new layers are inserted
  // right after the last active-page layer (not at the very end of the array).
  const byId = new Map(layers.map((l) => [l.id, { ...l, pageIndex }]));
  const result: CanvasLayer[] = [];
  const placed = new Set<string>();
  let lastActiveIdx = -1;
  for (const layer of doc.layers) {
    if ((layer.pageIndex ?? 0) !== pageIndex) {
      result.push(layer);
      continue;
    }
    const next = byId.get(layer.id);
    if (next) {
      result.push(next);
      placed.add(layer.id);
      lastActiveIdx = result.length - 1;
    }
  }
  const newLayers: CanvasLayer[] = [];
  for (const layer of layers) {
    if (!placed.has(layer.id)) {
      newLayers.push({ ...layer, pageIndex });
    }
  }
  if (newLayers.length) {
    result.splice(lastActiveIdx + 1, 0, ...newLayers);
  }
  return { ...doc, layers: result };
}

export function chunkArray<T>(items: T[], perPage: number): T[][] {
  if (perPage <= 0) return items.length ? [items] : [[]];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) {
    chunks.push(items.slice(i, i + perPage));
  }
  return chunks.length ? chunks : [[]];
}

export function chunkImages(images: string[], perPage: number): string[][] {
  return chunkArray(images, perPage);
}

/** Photo capacity of the template page (page 0), else max slots on any page. */
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
  const page0 = byPage.get(0);
  if (page0 && page0 > 0) return page0;
  return Math.max(...byPage.values());
}

/** Keep settings.imagesPerPage aligned with template image slots. */
export function syncImagesPerPage(doc: CanvasDocument): CanvasDocument {
  const n = templateImagesPerPage(doc);
  if (doc.settings?.imagesPerPage === n) return doc;
  return {
    ...doc,
    settings: { ...doc.settings, imagesPerPage: n },
  };
}

export function renderMultiPageHtml(
  doc: CanvasDocument,
  ctx: FillContext,
  options?: { imagesPerPage?: number; forScreen?: boolean },
): string {
  const plan = planMultiPageRender(doc, ctx, options);
  return mergeCanvasHtmlDocuments(
    plan.map((p) => renderCanvasHtml(p.pageDoc, p.pageCtx, { forScreen: options?.forScreen })),
  );
}

/** Same as renderMultiPageHtml but yields between pages so large templates stay responsive. */
export async function renderMultiPageHtmlAsync(
  doc: CanvasDocument,
  ctx: FillContext,
  options?: { imagesPerPage?: number; forScreen?: boolean },
): Promise<string> {
  const plan = planMultiPageRender(doc, ctx, options);
  const out: string[] = [];
  for (let i = 0; i < plan.length; i += 1) {
    out.push(renderCanvasHtml(plan[i].pageDoc, plan[i].pageCtx, { forScreen: options?.forScreen }));
    if (i > 0 && i % 2 === 0) {
      await new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
        else setTimeout(resolve, 0);
      });
    }
  }
  return mergeCanvasHtmlDocuments(out);
}

export function planMultiPageRender(
  doc: CanvasDocument,
  ctx: FillContext,
  options?: { imagesPerPage?: number },
): Array<{ pageDoc: CanvasDocument; pageCtx: FillContext }> {
  const slotPerPage = templateImagesPerPage(doc);
  // Slots win when present; options/settings only apply when the template has no slots.
  const hasSlots = doc.layers.some((l) => l.type === 'imageSlot');
  const configured = options?.imagesPerPage ?? doc.settings?.imagesPerPage;
  const perPage = hasSlots
    ? slotPerPage
    : configured && configured > 0
      ? configured
      : Math.max(ctx.images.length, 1);
  const imageChunks = chunkImages(ctx.images, perPage);
  const imageMetaChunks = ctx.imageMeta ? chunkArray(ctx.imageMeta, perPage) : undefined;
  const docPageCount = getPageCount(doc);
  // Paginate by image chunks when more images than one page of slots; else use design pages
  const useImagePagination = perPage > 0 && ctx.images.length > perPage;
  const totalPages = useImagePagination
    ? Math.max(docPageCount, imageChunks.length)
    : docPageCount;

  return Array.from({ length: totalPages }, (_, pageIndex) => {
    const sourcePage = Math.min(pageIndex, docPageCount - 1);
    const pageDoc: CanvasDocument = {
      ...doc,
      layers: getActivePageLayers(doc, sourcePage),
    };
    const pageCtx: FillContext = {
      ...ctx,
      images: useImagePagination ? (imageChunks[pageIndex] ?? []) : ctx.images,
      imageMeta: useImagePagination && imageMetaChunks ? (imageMetaChunks[pageIndex] ?? []) : ctx.imageMeta,
    };
    return { pageDoc, pageCtx };
  });
}

/**
 * Same pagination as HTML export, but layers remapped to pageIndex 0 so each
 * slice renders cleanly in PageLayerPreview (default pageIndex=0).
 */
export function planMultiPageDocuments(
  doc: CanvasDocument,
  ctx: FillContext,
  options?: { imagesPerPage?: number },
): Array<{ pageDoc: CanvasDocument; pageCtx: FillContext }> {
  return planMultiPageRender(doc, ctx, options).map(({ pageDoc, pageCtx }) => ({
    pageDoc: {
      ...pageDoc,
      layers: pageDoc.layers.map((layer) => ({ ...layer, pageIndex: 0 })),
    },
    pageCtx,
  }));
}
