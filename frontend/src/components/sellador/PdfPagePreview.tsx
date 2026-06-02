import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { api } from '../../api';
import type { PdfPageSize } from './utils';
import { loadPdfDocument, renderPdfPageToDataUrl } from './pdfjs';
import { selladorPreviewDpr, selladorPreviewPixelWidth } from './previewDpi';

interface PdfPagePreviewProps {
  pdfBase64?: string | null;
  pdfPath?: string | null;
  pageNum?: number;
  width?: number;
  className?: string;
  onPageSize?: (size: PdfPageSize) => void;
  overlay?: React.ReactNode;
}

const DEFAULT_WIDTH = 900;
const WIDTH_BUCKET = 80;
const RENDER_CACHE_VERSION = 'hd-v2';
const renderCache = new Map<string, string>();

function bucketRenderWidth(width: number): number {
  const clamped = Math.max(width, 320);
  return Math.round(clamped / WIDTH_BUCKET) * WIDTH_BUCKET;
}

function buildCacheKey(
  pdfPath: string | null | undefined,
  pdfBase64: string | null | undefined,
  pageNum: number,
  cssWidth: number,
): string {
  const source = pdfPath?.trim() || `b64:${pdfBase64?.length ?? 0}`;
  const pixelWidth = selladorPreviewPixelWidth(cssWidth);
  return `${RENDER_CACHE_VERSION}:${source}:${pageNum}:${pixelWidth}`;
}

export default function PdfPagePreview({
  pdfBase64,
  pdfPath,
  pageNum = 1,
  width = DEFAULT_WIDTH,
  className = '',
  onPageSize,
  overlay,
}: PdfPagePreviewProps) {
  const [pageImageUrl, setPageImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renderKey, setRenderKey] = useState(0);
  const onPageSizeRef = useRef(onPageSize);
  const pageSizeReportedRef = useRef(false);
  const hasDisplayedImageRef = useRef(false);
  onPageSizeRef.current = onPageSize;

  const renderWidth = useMemo(() => bucketRenderWidth(width), [width]);
  const usePathMode = !!pdfPath?.trim();
  const previewPixelWidth = useMemo(() => selladorPreviewPixelWidth(renderWidth), [renderWidth]);
  const cacheKey = buildCacheKey(pdfPath, pdfBase64, pageNum, renderWidth);

  useEffect(() => {
    pageSizeReportedRef.current = false;
    hasDisplayedImageRef.current = false;
  }, [pdfPath, pdfBase64, pageNum]);

  useEffect(() => {
    if (!pdfPath && !pdfBase64) return undefined;

    const cached = renderCache.get(cacheKey);
    if (cached) {
      setPageImageUrl(cached);
      hasDisplayedImageRef.current = true;
      setLoading(false);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    const showBlockingLoader = !hasDisplayedImageRef.current;
    if (showBlockingLoader) setLoading(true);
    setError(null);

    async function renderPage() {
      if (usePathMode && pdfPath) {
        const rendered = await api.selladorRenderPage({
          pdf_path: pdfPath,
          page_num: pageNum,
          max_width: previewPixelWidth,
        });
        if (cancelled) return;
        const url = `data:${rendered.mime_type};base64,${rendered.image_base64}`;
        renderCache.set(cacheKey, url);
        setPageImageUrl(url);
        hasDisplayedImageRef.current = true;
        if (!pageSizeReportedRef.current) {
          onPageSizeRef.current?.({
            width: rendered.page_width,
            height: rendered.page_height,
          });
          pageSizeReportedRef.current = true;
        }
        setLoading(false);
        return;
      }

      const pdf = await loadPdfDocument(pdfBase64!);
      const rendered = await renderPdfPageToDataUrl(pdf, pageNum, renderWidth, selladorPreviewDpr());
      if (cancelled) return;
      renderCache.set(cacheKey, rendered.url);
      setPageImageUrl(rendered.url);
      hasDisplayedImageRef.current = true;
      if (!pageSizeReportedRef.current) {
        onPageSizeRef.current?.(rendered.pageSize);
        pageSizeReportedRef.current = true;
      }
      setLoading(false);
    }

    renderPage().catch((err) => {
      if (cancelled) return;
      setLoading(false);
      if (!renderCache.get(cacheKey)) {
        setPageImageUrl(null);
      }
      setError(err instanceof Error ? err.message : 'No se pudo renderizar el PDF.');
    });

    return () => { cancelled = true; };
  }, [cacheKey, pageNum, pdfBase64, pdfPath, previewPixelWidth, renderKey, renderWidth, usePathMode]);

  const retry = useCallback(() => {
    renderCache.delete(cacheKey);
    setRenderKey((value) => value + 1);
  }, [cacheKey]);

  const showSpinner = loading && !pageImageUrl;

  return (
    <div className={`relative w-full overflow-hidden rounded-lg border border-[var(--accent-primary)]/30 bg-white ${className}`}>
      {pageImageUrl ? (
        <div className="relative">
          <img
            data-stamp-page-image
            src={pageImageUrl}
            alt={`Página ${pageNum}`}
            className="block h-auto w-full max-w-full select-none"
            style={{ imageRendering: 'auto' }}
            draggable={false}
          />
          {overlay ? <div className="absolute inset-0">{overlay}</div> : null}
        </div>
      ) : null}

      {showSpinner ? (
        <div className="flex min-h-[420px] items-center justify-center bg-white text-[var(--text-muted)]">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : null}

      {!loading && error ? (
        <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center text-[var(--text-muted)]">
          <AlertCircle size={24} className="text-[var(--accent-primary)] opacity-70" />
          <p className="text-sm">{error}</p>
          <button
            type="button"
            onClick={retry}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border-medium)] px-4 py-2 text-[10px] font-mono uppercase tracking-widest hover:bg-[var(--bg-elevated)]"
          >
            <RefreshCw size={12} />
            Reintentar
          </button>
        </div>
      ) : null}
    </div>
  );
}
