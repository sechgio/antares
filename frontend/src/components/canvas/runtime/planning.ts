import type { FillContext } from './renderHtml';
import { mergeCanvasHtmlDocuments, renderCanvasHtml } from './renderHtml';
import type { CanvasDocument } from '../types';
import { getActivePageLayers, getPageCount, templateImagesPerPage } from '../ops/pages';

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
  const slotPages = new Set<number>();
  for (const layer of doc.layers) {
    if (layer.type !== 'imageSlot') continue;
    slotPages.add(layer.pageIndex ?? 0);
  }
  const hasSlots = slotPages.size > 0;
  const firstSlotPage = hasSlots ? Math.min(...slotPages) : -1;
  const lastSlotPage = hasSlots ? Math.max(...slotPages) : -1;

  const slotPerPage = templateImagesPerPage(doc);
  const configured = options?.imagesPerPage ?? doc.settings?.imagesPerPage;
  const perPage = hasSlots
    ? slotPerPage
    : configured && configured > 0
      ? configured
      : Math.max(ctx.images.length, 1);
  const imageChunks = chunkImages(ctx.images, perPage);
  const imageMetaChunks = ctx.imageMeta ? chunkArray(ctx.imageMeta, perPage) : undefined;
  const docPageCount = getPageCount(doc);
  const useImagePagination = perPage > 0 && ctx.images.length > perPage;

  const emptyMeta = ctx.imageMeta ? ([] as NonNullable<FillContext['imageMeta']>) : undefined;
  const slice = (
    sourcePage: number,
    images: string[],
    imageMeta: FillContext['imageMeta'],
  ): { pageDoc: CanvasDocument; pageCtx: FillContext } => ({
    pageDoc: { ...doc, layers: getActivePageLayers(doc, sourcePage) },
    pageCtx: { ...ctx, images, imageMeta },
  });

  if (hasSlots && useImagePagination) {
    const plan: Array<{ pageDoc: CanvasDocument; pageCtx: FillContext }> = [];
    for (let i = 0; i < firstSlotPage; i += 1) {
      plan.push(slice(i, [], emptyMeta));
    }
    for (let c = 0; c < imageChunks.length; c += 1) {
      const chunk = imageChunks[c]!;
      const metaChunk = imageMetaChunks ? (imageMetaChunks[c] ?? []) : undefined;
      for (let i = firstSlotPage; i <= lastSlotPage; i += 1) {
        plan.push(slice(i, chunk, metaChunk));
      }
    }
    for (let i = lastSlotPage + 1; i < docPageCount; i += 1) {
      plan.push(slice(i, [], emptyMeta));
    }
    return plan;
  }

  if (hasSlots) {
    return Array.from({ length: docPageCount }, (_, pageIndex) => {
      const pageHasSlots = slotPages.has(pageIndex);
      return slice(
        pageIndex,
        pageHasSlots ? ctx.images : [],
        pageHasSlots ? ctx.imageMeta : emptyMeta,
      );
    });
  }

  const totalPages = useImagePagination
    ? Math.max(docPageCount, imageChunks.length)
    : docPageCount;

  return Array.from({ length: totalPages }, (_, pageIndex) => {
    const sourcePage = Math.min(pageIndex, docPageCount - 1);
    return slice(
      sourcePage,
      useImagePagination ? (imageChunks[pageIndex] ?? []) : ctx.images,
      useImagePagination && imageMetaChunks
        ? (imageMetaChunks[pageIndex] ?? [])
        : ctx.imageMeta,
    );
  });
}

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
