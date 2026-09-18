import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePdfImport } from '../hooks/usePdfImport';
import { createEmptyDocument, type CanvasDocument } from '../types';
import type { PdfImportReport } from '../import/pdfImportTypes';

const inspectPdfFile = vi.fn();
const importPdfFile = vi.fn();
const appendPdfFragment = vi.fn();

vi.mock('../import/importPdf', () => ({
  inspectPdfFile: (...args: unknown[]) => inspectPdfFile(...args),
  importPdfFile: (...args: unknown[]) => importPdfFile(...args),
}));

vi.mock('../import/pdfToCanvas', () => ({
  appendPdfFragment: (...args: unknown[]) => appendPdfFragment(...args),
}));

const REPORT: PdfImportReport = {
  importedCount: 3,
  skippedCount: 1,
  pagesProcessed: 1,
  issues: [],
  warnings: [],
};

function makeHarness(doc?: CanvasDocument) {
  const document = doc ?? createEmptyDocument('t');
  const history = {
    documentRef: { current: document },
    setDocument: vi.fn(),
  };
  const input = {
    history,
    flashStatus: vi.fn(),
    setSelectedIds: vi.fn(),
    setPageIndex: vi.fn(),
  };
  const file = new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' });
  const changeEvent = { target: { files: [file], value: 'x' } } as unknown as React.ChangeEvent<HTMLInputElement>;
  return { input, file, changeEvent };
}

describe('usePdfImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('onPdfFileChange inspecciona el archivo y publica el preflight', async () => {
    const preflight = { pageCount: 2, pageSizes: [], hasMixedPageSizes: false };
    inspectPdfFile.mockResolvedValue(preflight);
    const { input, changeEvent } = makeHarness();
    const { result } = renderHook(() => usePdfImport(input));
    await act(async () => {
      await result.current.onPdfFileChange(changeEvent);
    });
    expect(inspectPdfFile).toHaveBeenCalledTimes(1);
    expect(result.current.pdfPreflight).toBe(preflight);
    expect(result.current.pdfFile?.name).toBe('doc.pdf');
    expect(result.current.pdfImportError).toBeNull();
  });

  it('un fallo de inspección deja pdfImportError y limpia el archivo', async () => {
    inspectPdfFile.mockRejectedValue(new Error('PDF cifrado'));
    const { input, changeEvent } = makeHarness();
    const { result } = renderHook(() => usePdfImport(input));
    await act(async () => {
      await result.current.onPdfFileChange(changeEvent);
    });
    expect(result.current.pdfImportError).toBe('PDF cifrado');
    expect(result.current.pdfFile).toBeNull();
    expect(result.current.pdfPreflight).toBeNull();
  });

  it('cancelPdfImportOptions ignora un preflight que llega tarde', async () => {
    let resolveInspect!: (v: unknown) => void;
    inspectPdfFile.mockImplementation(
      () => new Promise((res) => {
        resolveInspect = res;
      }),
    );
    const { input, changeEvent } = makeHarness();
    const { result } = renderHook(() => usePdfImport(input));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.onPdfFileChange(changeEvent);
    });
    await act(async () => {
      await vi.waitFor(() => expect(inspectPdfFile).toHaveBeenCalledTimes(1));
    });
    act(() => result.current.cancelPdfImportOptions());
    await act(async () => {
      resolveInspect({ pageCount: 9, pageSizes: [], hasMixedPageSizes: true });
      await pending;
    });
    expect(result.current.pdfPreflight).toBeNull();
    expect(result.current.pdfFile).toBeNull();
  });

  it('confirmPdfImport añade el fragmento, selecciona capas y salta de página', async () => {
    const doc = createEmptyDocument('t');
    const nextDoc = { ...doc, name: 'con-pdf' };
    const fragment = {
      firstPageIndex: 1,
      importedLayerIds: ['l1', 'l2'],
      pages: [],
      layers: [],
      fields: [],
      report: REPORT,
    };
    appendPdfFragment.mockReturnValue(nextDoc);
    importPdfFile.mockResolvedValue({ fragment, report: REPORT });
    inspectPdfFile.mockResolvedValue({ pageCount: 1, pageSizes: [], hasMixedPageSizes: false });

    const { input, changeEvent } = makeHarness(doc);
    const { result } = renderHook(() => usePdfImport(input));
    await act(async () => {
      await result.current.onPdfFileChange(changeEvent);
    });
    await act(async () => {
      await result.current.confirmPdfImport({
        pageStart: 1,
        pageEnd: 1,
        mixedPagePolicy: 'reject',
      });
    });

    expect(importPdfFile).toHaveBeenCalledTimes(1);
    const importArgs = importPdfFile.mock.calls[0];
    expect(importArgs[1]).toMatchObject({ pageStart: 1, pageEnd: 1, mixedPagePolicy: 'reject' });
    expect(importArgs[1].signal).toBeInstanceOf(AbortSignal);
    expect(appendPdfFragment).toHaveBeenCalledWith(doc, fragment);
    expect(input.history.setDocument).toHaveBeenCalledWith(nextDoc);
    expect(input.setSelectedIds).toHaveBeenCalledWith(['l1', 'l2']);
    expect(input.setPageIndex).toHaveBeenCalledWith(2); // 1 página base + firstPageIndex 1
    expect(result.current.pdfImportReport).toBe(REPORT);
    expect(result.current.pdfImporting).toBe(false);
    expect(input.flashStatus).toHaveBeenCalledWith(
      '3 elementos importados; 1 aproximados u omitidos',
      5000,
    );
  });

  it('confirmPdfImport sin archivo no hace nada', async () => {
    const { input } = makeHarness();
    const { result } = renderHook(() => usePdfImport(input));
    await act(async () => {
      await result.current.confirmPdfImport({ pageStart: 1, pageEnd: 1, mixedPagePolicy: 'reject' });
    });
    expect(importPdfFile).not.toHaveBeenCalled();
  });

  it('un AbortError muestra "Importación cancelada"', async () => {
    inspectPdfFile.mockResolvedValue({ pageCount: 1, pageSizes: [], hasMixedPageSizes: false });
    importPdfFile.mockRejectedValue(new DOMException('abort', 'AbortError'));
    const { input, changeEvent } = makeHarness();
    const { result } = renderHook(() => usePdfImport(input));
    await act(async () => {
      await result.current.onPdfFileChange(changeEvent);
    });
    await act(async () => {
      await result.current.confirmPdfImport({ pageStart: 1, pageEnd: 1, mixedPagePolicy: 'reject' });
    });
    expect(result.current.pdfImportError).toBe('Importación cancelada');
    expect(result.current.pdfImporting).toBe(false);
  });

  it('un fallo de importación publica el mensaje de error', async () => {
    inspectPdfFile.mockResolvedValue({ pageCount: 1, pageSizes: [], hasMixedPageSizes: false });
    importPdfFile.mockRejectedValue(new Error('límite de páginas excedido'));
    const { input, changeEvent } = makeHarness();
    const { result } = renderHook(() => usePdfImport(input));
    await act(async () => {
      await result.current.onPdfFileChange(changeEvent);
    });
    await act(async () => {
      await result.current.confirmPdfImport({ pageStart: 1, pageEnd: 1, mixedPagePolicy: 'reject' });
    });
    expect(result.current.pdfImportError).toBe('límite de páginas excedido');
    expect(input.history.setDocument).not.toHaveBeenCalled();
  });

  it('un segundo confirmPdfImport concurrente se ignora', async () => {
    inspectPdfFile.mockResolvedValue({ pageCount: 1, pageSizes: [], hasMixedPageSizes: false });
    let resolveImport!: (v: unknown) => void;
    importPdfFile.mockImplementation(
      () => new Promise((res) => {
        resolveImport = res;
      }),
    );
    const { input, changeEvent } = makeHarness();
    const { result } = renderHook(() => usePdfImport(input));
    await act(async () => {
      await result.current.onPdfFileChange(changeEvent);
    });
    let first!: Promise<void>;
    act(() => {
      first = result.current.confirmPdfImport({ pageStart: 1, pageEnd: 1, mixedPagePolicy: 'reject' });
    });
    await act(async () => {
      await vi.waitFor(() => expect(importPdfFile).toHaveBeenCalledTimes(1));
    });
    await act(async () => {
      await result.current.confirmPdfImport({ pageStart: 1, pageEnd: 1, mixedPagePolicy: 'reject' });
      resolveImport({
        fragment: { firstPageIndex: 0, importedLayerIds: [], pages: [], layers: [], fields: [] },
        report: REPORT,
      });
      await first;
    });
    expect(importPdfFile).toHaveBeenCalledTimes(1);
  });
});
