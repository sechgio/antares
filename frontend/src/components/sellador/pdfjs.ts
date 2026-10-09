import type { PDFDocumentProxy } from 'pdfjs-dist';
import { safeBase64ToBytes } from '../formatos/base64';
import { ensurePdfJs } from '../../lib/pdfjs';
export { ensurePdfJs } from '../../lib/pdfjs';
import {
  MAX_PREVIEW_PIXEL_WIDTH,
  MIN_PREVIEW_PIXEL_WIDTH,
  selladorPreviewDpr,
} from './previewDpi';
import type { PdfPageSize } from './utils';

export async function loadPdfDocument(pdfBase64: string) {
  const pdfjs = await ensurePdfJs();
  return pdfjs.getDocument({ data: safeBase64ToBytes(pdfBase64) }).promise;
}

export async function renderPdfPageToDataUrl(
  pdf: PDFDocumentProxy,
  pageNum: number,
  containerW: number,
  dpr = 1.5,
): Promise<{ url: string; pageSize: PdfPageSize }> {
  const { canvas, pageSize } = await renderPdfPageToCanvas(pdf, pageNum, containerW, dpr);
  return { url: canvas.toDataURL('image/png'), pageSize };
}

export async function renderPdfPageToCanvas(
  pdf: PDFDocumentProxy,
  pageNum: number,
  containerW: number,
  dpr?: number,
): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; pageSize: PdfPageSize; pxScale: number }> {
  const page = await pdf.getPage(pageNum);
  const unscaled = page.getViewport({ scale: 1 });
  const pixelRatio = dpr ?? selladorPreviewDpr();
  const minScale = MIN_PREVIEW_PIXEL_WIDTH / unscaled.width;
  const maxScale = MAX_PREVIEW_PIXEL_WIDTH / unscaled.width;
  const scale = Math.min(Math.max((containerW / unscaled.width) * pixelRatio, minScale), maxScale);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const renderTask = page.render({
    canvasContext: ctx,
    viewport,
  });
  await renderTask.promise;

  return {
    canvas,
    ctx,
    pageSize: { width: unscaled.width, height: unscaled.height },
    pxScale: viewport.width / unscaled.width,
  };
}
