import type { PDFDocumentProxy } from 'pdfjs-dist';
import { api } from '../../api';
import {
  createObjectIdentity,
  hashPdfBase64,
  selladorPreviewCache,
} from './lruMap';
import { loadPdfDocument, renderPdfPageToCanvas } from './pdfjs';
import { acquireStagedFile, type StagedFileHandle } from '../../utils/stageFile';
import {
  selladorPreviewPixelWidth,
} from './previewDpi';
import type { PdfPageSize, StampRect } from './utils';

const WIDTH_BUCKET = 80;
const OTHER_PAGES_CACHE_VERSION = 'disp-v1';
const fileCacheIdentity = createObjectIdentity<File>();

function bucketContainerWidth(width: number): number {
  const clamped = Math.max(width, 320);
  return Math.round(clamped / WIDTH_BUCKET) * WIDTH_BUCKET;
}

export function otherPagesCacheKey(
  pdfPath: string | null,
  pdfBase64: string | null,
  pdfFile: File | null,
  sourceRevision: number,
  pageNum: number,
  containerW: number,
  stampUrl: string | null,
  stampRects: StampRect[],
  base64Fingerprint?: string,
): string {
  const source = pdfPath
    ?? (pdfFile
      ? `file:${fileCacheIdentity(pdfFile)}:${pdfFile.name}:${pdfFile.size}:${pdfFile.lastModified}`
      : `b64:${base64Fingerprint ?? hashPdfBase64(pdfBase64 ?? '')}`);
  const stamp = stampRects.map((r) => [r.x, r.y, r.width, r.height].map((value) => value.toFixed(2)).join(',')).join('|') || 'none';
  return `other:${OTHER_PAGES_CACHE_VERSION}:${sourceRevision}:${source}:${pageNum}:${bucketContainerWidth(containerW)}:${stampUrl ?? 'none'}:${stamp}`;
}

async function loadStampImage(stampUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen del sello'));
    img.src = stampUrl;
  });
}

function drawStampOnCanvas(
  ctx: CanvasRenderingContext2D,
  stampImg: HTMLImageElement,
  stampRect: StampRect,
  pxScale: number,
): void {
  ctx.drawImage(
    stampImg,
    stampRect.x * pxScale,
    stampRect.y * pxScale,
    stampRect.width * pxScale,
    stampRect.height * pxScale,
  );
}

async function drawStampsOnCanvas(
  ctx: CanvasRenderingContext2D,
  stampUrl: string,
  stampRects: StampRect[],
  pxScale: number,
): Promise<void> {
  if (stampRects.length === 0) return;
  const stampImg = await loadStampImage(stampUrl);
  stampRects.forEach((stampRect) => {
    drawStampOnCanvas(ctx, stampImg, stampRect, pxScale);
  });
}

async function renderPageWithStampFromPdf(
  pdf: PDFDocumentProxy,
  pageNum: number,
  containerW: number,
  stampUrl: string | null,
  stampRects: StampRect[],
): Promise<string> {
  const { canvas, ctx, pxScale } = await renderPdfPageToCanvas(pdf, pageNum, containerW);

  if (stampUrl && stampRects.length > 0) {
    await drawStampsOnCanvas(ctx, stampUrl, stampRects, pxScale);
  }

  return canvas.toDataURL('image/png');
}

async function renderPageWithStampFromPath(
  pdfPath: string,
  pageNum: number,
  containerW: number,
  stampUrl: string | null,
  stampRects: StampRect[],
  pageSize: PdfPageSize,
): Promise<string> {
  const rendered = await api.selladorRenderPage({
    pdf_path: pdfPath,
    page_num: pageNum,
    max_width: selladorPreviewPixelWidth(containerW),
  });
  const pageImg = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo renderizar la página'));
    img.src = `data:${rendered.mime_type};base64,${rendered.image_base64}`;
  });

  const canvas = document.createElement('canvas');
  canvas.width = pageImg.naturalWidth;
  canvas.height = pageImg.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(pageImg, 0, 0);

  if (stampUrl && stampRects.length > 0) {
    const pxScale = pageImg.naturalWidth / pageSize.width;
    await drawStampsOnCanvas(ctx, stampUrl, stampRects, pxScale);
  }

  return canvas.toDataURL('image/png');
}

export async function renderOtherPagesPreview(
  options: {
    pdfPath: string | null;
    pdfBase64: string | null;
    pdfFile: File | null;
    sourceRevision?: number;
    pageCount: number;
    pageNumbers?: number[];
    containerW: number;
    stampUrl: string | null;
    placementsByPage: Map<number, StampRect[]>;
    pageSize: PdfPageSize;
    assignmentCounts: Map<number, number>;
    onProgress: (previews: Array<{ pageNum: number; url: string; stampCount: number }>) => void;
    isCancelled: () => boolean;
  },
): Promise<void> {
  const {
    pdfPath,
    pdfBase64,
    pdfFile,
    sourceRevision = 0,
    pageCount,
    pageNumbers,
    containerW,
    stampUrl,
    placementsByPage,
    pageSize,
    assignmentCounts,
    onProgress,
    isCancelled,
  } = options;

  const bucketedWidth = bucketContainerWidth(containerW);
  const base64Fingerprint = !pdfPath && !pdfFile && pdfBase64 ? hashPdfBase64(pdfBase64) : undefined;
  const previews: Array<{ pageNum: number; url: string; stampCount: number }> = [];
  const pagesToRender = [...new Set(
    pageNumbers ?? Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => index + 2),
  )]
    .filter((pageNum) => pageNum >= 2 && pageNum <= pageCount);
  if (pagesToRender.length === 0) return;
  let lastReportedCount = 0;
  let pdf: PDFDocumentProxy | null = null;
  let pdfHandle: StagedFileHandle | null = null;

  const reportProgress = (force = false) => {
    if (isCancelled()) return;
    const shouldReport = force
      || previews.length === pagesToRender.length
      || previews.length - lastReportedCount >= 2;
    if (!shouldReport) return;
    lastReportedCount = previews.length;
    onProgress([...previews]);
  };

  try {
    // Reuse one staged upload for every page in this batch.
    if (!pdfPath && !pdfBase64 && pdfFile) {
      pdfHandle = await acquireStagedFile(pdfFile);
      if (!pdfHandle.token) {
        throw new Error('No se pudo preparar el PDF para la vista previa.');
      }
    } else if (!pdfPath && pdfBase64) {
      pdf = await loadPdfDocument(pdfBase64);
    }

    for (const pageNum of pagesToRender) {
      if (isCancelled()) break;
      const stampsOnPage = assignmentCounts.get(pageNum) ?? 0;
      const stampRects = placementsByPage.get(pageNum) ?? [];
      const cacheKey = otherPagesCacheKey(
        pdfPath,
        pdfBase64,
        pdfFile,
        sourceRevision,
        pageNum,
        bucketedWidth,
        stampUrl,
        stampRects,
        base64Fingerprint,
      );
      let url = selladorPreviewCache.get(cacheKey);
      if (!url) {
        if (pdfPath) {
          url = await renderPageWithStampFromPath(
            pdfPath,
            pageNum,
            bucketedWidth,
            stampUrl,
            stampRects,
            pageSize,
          );
        } else if (pdfHandle?.token) {
          url = await renderPageWithStampFromPath(
            pdfHandle.token,
            pageNum,
            bucketedWidth,
            stampUrl,
            stampRects,
            pageSize,
          );
        } else if (pdf) {
          url = await renderPageWithStampFromPdf(
            pdf,
            pageNum,
            bucketedWidth,
            stampUrl,
            stampRects,
          );
        } else {
          break;
        }
        selladorPreviewCache.set(cacheKey, url);
      }
      previews.push({ pageNum, url, stampCount: stampsOnPage });
      reportProgress();
      await new Promise<void>((r) => setTimeout(r, 0));
    }

    reportProgress(true);
  } finally {
    if (pdf) {
      try {
        await pdf.destroy();
      } catch {
      }
    }
    pdfHandle?.release();
  }
}
