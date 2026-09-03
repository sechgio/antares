import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { api } from '../../api';
import type { VisualMapping } from '../../types';
import MappingOverlay from './MappingOverlay';
import type { PdfPageSize } from './mappingCoords';
import {
  formatMappingLoadError,
  isStaleBackendError,
  renderMappingPageToDataUrl,
  withMappingLoadTimeout,
} from './mappingPdfRender';

interface MappingPreviewPanelProps {
  formatId: string;
  mapping: VisualMapping;
  onChange: (mapping: VisualMapping) => void;
  zoom: number;
  previewBlob?: Blob | null;
  sampleNumber?: number;
}

type LoadStage = 'rendering' | 'template' | 'idle';

const CONTAINER_WIDTH_RELOAD_THRESHOLD = 48;

async function loadPdfFromBlob(blob: Blob): Promise<PDFDocumentProxy> {
  const { ensurePdfJs } = await import('../sellador/pdfjs');
  const pdfjs = await ensurePdfJs();
  const ab = await blob.arrayBuffer();
  return pdfjs.getDocument({ data: new Uint8Array(ab) }).promise;
}

async function loadPdfFromBase64(pdfBase64: string): Promise<PDFDocumentProxy> {
  const { ensurePdfJs } = await import('../sellador/pdfjs');
  const { safeBase64ToBytes } = await import('./base64');
  const pdfjs = await ensurePdfJs();
  return pdfjs.getDocument({ data: safeBase64ToBytes(pdfBase64) }).promise;
}

export default function MappingPreviewPanel({
  formatId,
  mapping,
  onChange,
  zoom,
  previewBlob = null,
  sampleNumber = 1234,
}: MappingPreviewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const previewBlobRef = useRef(previewBlob);
  previewBlobRef.current = previewBlob;
  const loadGenerationRef = useRef(0);
  const cachedImageRef = useRef<{ url: string; size: PdfPageSize } | null>(null);
  const lastLoadTargetRef = useRef({ formatId: '', pageNum: 0 });
  const [pageImageUrl, setPageImageUrl] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<PdfPageSize | null>(null);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<LoadStage>('rendering');
  const [error, setError] = useState<string | null>(null);
  const [renderKey, setRenderKey] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  const pageNum = Math.max(1, mapping.page + 1);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;

    const updateWidth = () => {
      const next = Math.max(node.clientWidth - 32, 200);
      setContainerWidth((prev) => {
        if (prev > 0 && Math.abs(next - prev) < CONTAINER_WIDTH_RELOAD_THRESHOLD) return prev;
        return next;
      });
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (containerWidth <= 0) return undefined;

    const generation = ++loadGenerationRef.current;
    const targetChanged =
      lastLoadTargetRef.current.formatId !== formatId
      || lastLoadTargetRef.current.pageNum !== pageNum;
    if (targetChanged) {
      cachedImageRef.current = null;
      lastLoadTargetRef.current = { formatId, pageNum };
    }
    const hasCachedImage = cachedImageRef.current !== null;

    setLoading(true);
    setStage('rendering');
    setError(null);
    if (!hasCachedImage) {
      setPageImageUrl(null);
      setPageSize(null);
    }

    const targetPixelWidth = Math.round(Math.min(containerWidth * 2, 1800));

    async function renderFromPdf(pdf: PDFDocumentProxy) {
      const targetPage = Math.min(pageNum, pdf.numPages);
      const rendered = await renderMappingPageToDataUrl(pdf, targetPage, containerWidth);
      if (generation !== loadGenerationRef.current) return false;
      cachedImageRef.current = { url: rendered.url, size: rendered.pageSize };
      setPageImageUrl(rendered.url);
      setPageSize(rendered.pageSize);
      setLoading(false);
      return true;
    }

    async function tryBackendRender() {
      const res = await api.formatosRenderTemplatePage({
        format_id: formatId,
        page_num: pageNum,
        max_width: targetPixelWidth,
      });
      if (generation !== loadGenerationRef.current) return false;
      const url = `data:${res.mime_type};base64,${res.image_base64}`;
      const size = { width: res.page_width, height: res.page_height };
      cachedImageRef.current = { url, size };
      setPageImageUrl(url);
      setPageSize(size);
      setLoading(false);
      return true;
    }

    async function tryBlobRender(blob: Blob) {
      const pdf = await loadPdfFromBlob(blob);
      if (generation !== loadGenerationRef.current) return false;
      return renderFromPdf(pdf);
    }

    async function tryTemplateRender() {
      const res = await api.formatosGetTemplate(formatId);
      if (generation !== loadGenerationRef.current) return false;
      const pdf = await loadPdfFromBase64(res.pdf_base64);
      if (generation !== loadGenerationRef.current) return false;
      return renderFromPdf(pdf);
    }

    async function loadPreview() {
      let lastError: Error | null = null;

      try {
        if (await withMappingLoadTimeout(tryBackendRender())) return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('No se pudo renderizar el template.');
        if (isStaleBackendError(err)) {
          if (generation !== loadGenerationRef.current) return;
          setLoading(false);
          setError(formatMappingLoadError(err));
          return;
        }
      }

      if (generation !== loadGenerationRef.current) return;
      setStage('template');

      const blobFallback = previewBlobRef.current;
      if (blobFallback) {
        try {
          if (await withMappingLoadTimeout(tryBlobRender(blobFallback))) return;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error('No se pudo renderizar la vista previa.');
        }
      }

      try {
        if (await withMappingLoadTimeout(tryTemplateRender())) return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('No se pudo cargar el template.');
      }

      if (generation !== loadGenerationRef.current) return;
      setLoading(false);
      setError(formatMappingLoadError(lastError));
    }

    loadPreview().catch((err) => {
      if (generation !== loadGenerationRef.current) return;
      setLoading(false);
      setError(formatMappingLoadError(err));
    });

    return undefined;
  }, [containerWidth, formatId, pageNum, renderKey]);

  const handleMappingRectChange = (partial: Pick<VisualMapping, 'x' | 'y' | 'width' | 'height'>) => {
    onChange({ ...mapping, ...partial });
  };

  if (error) {
    return (
      <div ref={containerRef} className="flex h-full flex-col items-center justify-center gap-4 px-8">
        <AlertCircle size={24} className="text-[var(--accent-primary)] opacity-70" />
        <p className="max-w-[320px] text-center text-[11px] text-[var(--text-muted)]" style={{ fontFamily: "'Roboto Mono', monospace" }}>
          {error}
        </p>
        <button
          type="button"
          onClick={() => {
            cachedImageRef.current = null;
            setRenderKey((value) => value + 1);
          }}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-4 py-2 text-[10px] tracking-wider text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          style={{ fontFamily: "'Roboto Mono', monospace" }}
        >
          <RefreshCw size={11} />
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative z-[1] h-full w-full overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--scrollbar-thumb) transparent' }}>
      <div className="flex flex-col items-center px-4 py-6">
        {loading && !pageImageUrl ? (
          <div className="flex items-center gap-2 py-16 text-[var(--text-muted)]">
            <Loader2 size={16} className="animate-spin text-[var(--accent-primary)]/40" />
            <span className="text-[10px] tracking-widest" style={{ fontFamily: "'Roboto Mono', monospace" }}>
              {stage === 'rendering' ? 'renderizando página…' : 'cargando template…'}
            </span>
          </div>
        ) : null}
        {pageImageUrl && pageSize ? (
          <div
            className="relative mx-auto rounded-xl bg-white shadow-2xl shadow-black/50"
            style={{ width: `${zoom}%`, maxWidth: '100%' }}
          >
            <div className="relative">
              <img
                ref={imageRef}
                data-mapping-page-image
                src={pageImageUrl}
                alt={`Template página ${pageNum}`}
                className="block h-auto w-full select-none rounded-lg"
                draggable={false}
              />
              <MappingOverlay
                mapping={mapping}
                pageSize={pageSize}
                imageRef={imageRef}
                sampleNumber={sampleNumber}
                onChange={handleMappingRectChange}
              />
            </div>
            <div
              className="pointer-events-none absolute bottom-3 right-3 rounded border border-[var(--accent-primary)]/25 px-2 py-1"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--bg-base) 80%, transparent)',
                fontFamily: "'Roboto Mono', monospace",
              }}
            >
              <span className="text-[8px] text-[var(--text-muted)]">Pág. </span>
              <span className="text-[10px] font-medium tracking-widest text-[var(--accent-primary)]">{pageNum}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
