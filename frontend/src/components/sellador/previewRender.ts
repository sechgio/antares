import type { PDFDocumentProxy } from 'pdfjs-dist';
import { api } from '../../api';
import { loadPdfDocument } from './pdfjs';
import { selladorPreviewPixelWidth } from './previewDpi';
import type { PdfPageSize, StampRect } from './utils';

const WIDTH_BUCKET = 80;
const OTHER_PAGES_CACHE_VERSION = 'hd-v2';
const otherPagesRenderCache = new Map<string, string>();

function bucketContainerWidth(width: number): number {
  const clamped = Math.max(width, 320);
  return Math.round(clamped / WIDTH_BUCKET) * WIDTH_BUCKET;
}

function otherPagesCacheKey(
  pdfPath: string | null,
  pdfBase64: string | null,
  pageNum: number,
  containerW: number,
  stampRects: StampRect[],
): string {
  const source = pdfPath ?? `b64:${pdfBase64?.length ?? 0}`;
  const stamp = stampRects.map((r) => `${r.x},${r.y},${r.width},${r.height}`).join('|') || 'none';
  return `${OTHER_PAGES_CACHE_VERSION}:${source}:${pageNum}:${containerW}:${stamp}`;
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

export async function renderPageWithStampFromPdf(
  pdf: PDFDocumentProxy,
  pageNum: number,
  containerW: number,
  stampUrl: string | null,
  stampRects: StampRect[],
): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const unscaled = page.getViewport({ scale: 1 });
  const dpr = typeof window !== 'undefined'
    ? Math.min(Math.max(window.devicePixelRatio || 1, 1.5) * 2.5, 4)
    : 2.5;
  const minScale = 2800 / unscaled.width;
  const scale = Math.min(Math.max((containerW / unscaled.width) * dpr, minScale), 4);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  if (stampUrl && stampRects.length > 0) {
    const pxScale = viewport.width / unscaled.width;
    await drawStampsOnCanvas(ctx, stampUrl, stampRects, pxScale);
  }

  return canvas.toDataURL('image/png');
}

export async function renderPageWithStampFromPath(
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
    pageCount: number;
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
    pageCount,
    containerW,
    stampUrl,
    placementsByPage,
    pageSize,
    assignmentCounts,
    onProgress,
    isCancelled,
  } = options;

  const bucketedWidth = bucketContainerWidth(containerW);
  const previews: Array<{ pageNum: number; url: string; stampCount: number }> = [];
  const pdf = pdfPath ? null : await loadPdfDocument(pdfBase64!);
  let lastReportedCount = 0;

  const reportProgress = (force = false) => {
    if (isCancelled()) return;
    const shouldReport = force
      || previews.length === pageCount - 1
      || previews.length - lastReportedCount >= 2;
    if (!shouldReport) return;
    lastReportedCount = previews.length;
    onProgress([...previews]);
  };

  for (let pageNum = 2; pageNum <= pageCount; pageNum += 1) {
    if (isCancelled()) break;
    const stampsOnPage = assignmentCounts.get(pageNum) ?? 0;
    const stampRects = placementsByPage.get(pageNum) ?? [];
    const cacheKey = otherPagesCacheKey(
      pdfPath,
      pdfBase64,
      pageNum,
      bucketedWidth,
      stampRects,
    );
    let url = otherPagesRenderCache.get(cacheKey);
    if (!url) {
      url = pdfPath
        ? await renderPageWithStampFromPath(
          pdfPath,
          pageNum,
          bucketedWidth,
          stampUrl,
          stampRects,
          pageSize,
        )
        : await renderPageWithStampFromPdf(
          pdf!,
          pageNum,
          bucketedWidth,
          stampUrl,
          stampRects,
        );
      otherPagesRenderCache.set(cacheKey, url);
    }
    previews.push({ pageNum, url, stampCount: stampsOnPage });
    reportProgress();
  }

  reportProgress(true);
}
