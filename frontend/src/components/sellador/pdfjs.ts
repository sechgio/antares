import type { PDFDocumentProxy } from 'pdfjs-dist';
import { safeBase64ToBytes } from '../formatos/base64';
import {
  MAX_PREVIEW_PIXEL_WIDTH,
  MIN_PREVIEW_PIXEL_WIDTH,
} from './previewDpi';
import type { PdfPageSize } from './utils';

let pdfjsLib: typeof import('pdfjs-dist') | null = null;
let pdfWorkerUrl: string | null = null;

export async function ensurePdfJs() {
  if (pdfjsLib) return pdfjsLib;
  const pdfjs = await import('pdfjs-dist');
  if (!pdfWorkerUrl) {
    try {
      const workerModule = await import('pdfjs-dist/build/pdf.worker.min.mjs?url') as { default: string };
      pdfWorkerUrl = workerModule.default;
    } catch {
      pdfWorkerUrl = '';
    }
  }
  if (pdfWorkerUrl) {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  }
  pdfjsLib = pdfjs;
  return pdfjs;
}

export async function loadPdfDocument(pdfBase64: string) {
  const pdfjs = await ensurePdfJs();
  return pdfjs.getDocument({ data: safeBase64ToBytes(pdfBase64) }).promise;
}

export async function getPdfPageSize(pdfBase64: string, pageNum = 1): Promise<PdfPageSize> {
  const pdf = await loadPdfDocument(pdfBase64);
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  return { width: viewport.width, height: viewport.height };
}

export async function renderPdfPageToDataUrl(
  pdf: PDFDocumentProxy,
  pageNum: number,
  containerW: number,
  dpr = 1.5,
): Promise<{ url: string; pageSize: PdfPageSize }> {
  const page = await pdf.getPage(pageNum);
  const unscaled = page.getViewport({ scale: 1 });
  // Display-path caps from previewDpi (preview only; export apply is separate).
  const minScale = MIN_PREVIEW_PIXEL_WIDTH / unscaled.width;
  const maxScale = MAX_PREVIEW_PIXEL_WIDTH / unscaled.width;
  const scale = Math.min(Math.max((containerW / unscaled.width) * dpr, minScale), maxScale);
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
    url: canvas.toDataURL('image/png'),
    pageSize: { width: unscaled.width, height: unscaled.height },
  };
}
