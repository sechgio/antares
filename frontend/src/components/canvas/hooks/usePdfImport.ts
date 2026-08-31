import { useCallback, useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { getPageCount } from '../ops/pages';
import { appendPdfFragment } from '../import/pdfToCanvas';
import type {
  PdfImportOptions,
  PdfImportOptionsValue,
  PdfImportPreflight,
  PdfImportProgress,
  PdfImportReport,
} from '../import/pdfImportTypes';
import type { CanvasHistoryHandle } from './useCanvasHistory';

interface UsePdfImportOptions {
  history: Pick<CanvasHistoryHandle, 'documentRef' | 'setDocument'>;
  flashStatus: (message: string, ms?: number) => void;
  setSelectedIds: (ids: string[]) => void;
  setPageIndex: (index: number) => void;
}

export interface UsePdfImportResult {
  pdfFile: File | null;
  pdfPreflight: PdfImportPreflight | null;
  pdfImportProgress: PdfImportProgress | null;
  pdfImportReport: PdfImportReport | null;
  pdfImportError: string | null;
  pdfImporting: boolean;
  pdfInputRef: RefObject<HTMLInputElement>;
  onImportPdf: () => void;
  onPdfFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  cancelPdfImport: () => void;
  cancelPdfImportOptions: () => void;
  confirmPdfImport: (options: PdfImportOptionsValue) => Promise<void>;
}

export function usePdfImport({
  history,
  flashStatus,
  setSelectedIds,
  setPageIndex,
}: UsePdfImportOptions): UsePdfImportResult {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPreflight, setPdfPreflight] = useState<PdfImportPreflight | null>(null);
  const [pdfImportProgress, setPdfImportProgress] = useState<PdfImportProgress | null>(null);
  const [pdfImportReport, setPdfImportReport] = useState<PdfImportReport | null>(null);
  const [pdfImportError, setPdfImportError] = useState<string | null>(null);
  const [pdfImporting, setPdfImporting] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const pdfImportControllerRef = useRef<AbortController | null>(null);
  const selectionGenerationRef = useRef(0);

  useEffect(
    () => () => {
      selectionGenerationRef.current += 1;
      pdfImportControllerRef.current?.abort();
    },
    [],
  );

  const onImportPdf = useCallback(() => {
    if (pdfImporting) return;
    pdfInputRef.current?.click();
  }, [pdfImporting]);

  const onPdfFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] || null;
      event.target.value = '';
      if (!file || pdfImporting) return;

      const generation = ++selectionGenerationRef.current;
      setPdfFile(file);
      setPdfPreflight(null);
      setPdfImportReport(null);
      setPdfImportProgress(null);
      setPdfImportError(null);
      try {
        const { inspectPdfFile } = await import('../import/importPdf');
        const preflight = await inspectPdfFile(file);
        if (generation !== selectionGenerationRef.current) return;
        setPdfPreflight(preflight);
      } catch (error) {
        if (generation !== selectionGenerationRef.current) return;
        const message = error instanceof Error ? error.message : 'No se pudo inspeccionar el PDF';
        setPdfFile(null);
        setPdfImportError(message);
      }
    },
    [pdfImporting],
  );

  const cancelPdfImport = useCallback(() => {
    pdfImportControllerRef.current?.abort();
  }, []);

  const cancelPdfImportOptions = useCallback(() => {
    if (pdfImporting) return;
    selectionGenerationRef.current += 1;
    setPdfFile(null);
    setPdfPreflight(null);
    setPdfImportProgress(null);
    setPdfImportError(null);
  }, [pdfImporting]);

  const confirmPdfImport = useCallback(
    async ({ pageStart, pageEnd, mixedPagePolicy }: PdfImportOptionsValue) => {
      const file = pdfFile;
      if (!file || pdfImportControllerRef.current) return;
      const controller = new AbortController();
      pdfImportControllerRef.current = controller;
      setPdfImporting(true);
      setPdfImportError(null);
      setPdfImportReport(null);
      try {
        const { importPdfFile } = await import('../import/importPdf');
        const importOptions: PdfImportOptions = {
          pageStart,
          pageEnd,
          mixedPagePolicy,
          signal: controller.signal,
          onProgress: setPdfImportProgress,
        };
        const result = await importPdfFile(file, importOptions);
        if (controller.signal.aborted) return;
        const currentDocument = history.documentRef.current;
        const firstImportedPage = getPageCount(currentDocument) + result.fragment.firstPageIndex;
        const next = appendPdfFragment(currentDocument, result.fragment);
        history.setDocument(next);
        setSelectedIds(result.fragment.importedLayerIds);
        setPageIndex(firstImportedPage);
        setPdfImportReport(result.report);
        flashStatus(
          `${result.report.importedCount} elementos importados; ${result.report.skippedCount} aproximados u omitidos`,
          5000,
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          setPdfImportError('Importación cancelada');
        } else {
          setPdfImportError(error instanceof Error ? error.message : 'No se pudo importar el PDF');
        }
      } finally {
        pdfImportControllerRef.current = null;
        setPdfImporting(false);
        setPdfFile(null);
        setPdfPreflight(null);
      }
    },
    [flashStatus, history, pdfFile, setPageIndex, setSelectedIds],
  );

  return {
    pdfFile,
    pdfPreflight,
    pdfImportProgress,
    pdfImportReport,
    pdfImportError,
    pdfImporting,
    pdfInputRef,
    onImportPdf,
    onPdfFileChange,
    cancelPdfImport,
    cancelPdfImportOptions,
    confirmPdfImport,
  };
}
