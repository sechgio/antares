import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importPdfFile } from '../importPdf';
import { parseCanvasManifest, serializeCanvasManifest } from '../pdfManifest';
import { createEmptyDocument } from '../../types';

const mocks = vi.hoisted(() => ({
  extractPdfDocument: vi.fn(),
  mapPdfPagesToCanvas: vi.fn(),
  ensurePdfJs: vi.fn(),
}));

vi.mock('../pdfExtract', () => ({
  extractPdfDocument: mocks.extractPdfDocument,
  throwIfAborted: (signal?: AbortSignal) => {
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
  },
}));
vi.mock('../pdfToCanvas', () => ({
  mapPdfPagesToCanvas: mocks.mapPdfPagesToCanvas,
}));
vi.mock('../../../../lib/pdfjs', () => ({
  ensurePdfJs: mocks.ensurePdfJs,
}));

describe('importPdfFile', () => {
  beforeEach(() => {
    mocks.extractPdfDocument.mockReset();
    mocks.mapPdfPagesToCanvas.mockReset();
    mocks.ensurePdfJs.mockReset();
  });

  afterEach(() => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = undefined;
  });

  it('validates file size before reading bytes', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(1));
    const file = {
      name: 'large.pdf',
      type: 'application/pdf',
      size: 101 * 1024 * 1024,
      arrayBuffer,
    } as unknown as File;

    await expect(importPdfFile(file)).rejects.toThrow('100 MiB');
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('emits pipeline progress and returns the complete fragment', async () => {
    const page = {
      pageNumber: 1,
      widthPt: 612,
      heightPt: 792,
      operators: 0,
      primitives: [],
      warnings: [],
    };
    const fragment = {
      pages: [{ id: 'p1', name: 'PDF Página 1' }],
      layers: [],
      fields: [],
      firstPageIndex: 0,
      importedLayerIds: ['layer-1'],
      report: { importedCount: 1, skippedCount: 0, pagesProcessed: 1, issues: [], warnings: [] },
    };
    mocks.extractPdfDocument.mockImplementation(async (_bytes: Uint8Array, options: { onProgress?: (progress: { stage: string }) => void }) => {
      options.onProgress?.({ stage: 'extracting' });
      return { pages: [page] };
    });
    mocks.mapPdfPagesToCanvas.mockReturnValue(fragment);

    const progress: string[] = [];
    const file = new File(['%PDF'], 'simple.pdf', { type: 'application/pdf' });
    const result = await importPdfFile(file, { onProgress: (value) => progress.push(value.stage) });

    expect(progress).toEqual(['loading', 'extracting', 'persisting', 'mapping']);
    expect(result.sourceName).toBe('simple.pdf');
    expect(result.fragment.importedLayerIds).toEqual(['layer-1']);
    expect(mocks.mapPdfPagesToCanvas).toHaveBeenCalledWith(expect.any(Array), expect.any(Object));
    expect(mocks.mapPdfPagesToCanvas.mock.calls[0]![0][0]).toMatchObject({ pageNumber: 1 });
  });

  it('prefers a valid Antares manifest over heuristic mapping', async () => {
    const document = createEmptyDocument('Exact round-trip');
    document.layers.push({
      id: 'manifest-text',
      type: 'text',
      name: 'Manifest text',
      value: 'Exacto',
      pageIndex: 0,
      cssVars: {
        '--width': '30mm',
        '--height': '8mm',
        '--translate-x': '10mm',
        '--translate-y': '10mm',
      },
    });
    const manifestBytes = Uint8Array.from(
      atob(await serializeCanvasManifest(document)),
      (char) => char.charCodeAt(0),
    );
    expect(parseCanvasManifest(manifestBytes)).not.toBeNull();
    mocks.extractPdfDocument.mockResolvedValue({
      pages: [{
        pageNumber: 1,
        widthPt: 612,
        heightPt: 792,
        operators: 1,
        primitives: [],
        warnings: [],
      }],
      manifestBytes,
    });

    const result = await importPdfFile(
      new File(['%PDF'], 'round-trip.pdf', { type: 'application/pdf' }),
    );

    expect(mocks.mapPdfPagesToCanvas).not.toHaveBeenCalled();
    expect(result.fragment.layers.some((layer) => layer.type === 'text' && layer.value === 'Exacto')).toBe(true);
    expect(result.report.importedCount).toBe(1);
  });

  it('hydrates round-trip manifest assets before returning the exact fragment', async () => {
    const get = vi.fn(async (ref: string) => ({
      ref,
      chunk: new Uint8Array([1, 2, 3]).buffer,
      bytes: 3,
    }));
    (window as unknown as { electronAPI?: unknown }).electronAPI = { canvasAssetGet: get };
    const document = createEmptyDocument('Exact image');
    document.layers.push({
      id: 'manifest-image',
      type: 'image',
      name: 'Manifest image',
      value: 'canvas-asset:abc123',
      pageIndex: 0,
      cssVars: {
        '--width': '10mm',
        '--height': '10mm',
        '--translate-x': '0mm',
        '--translate-y': '0mm',
      },
    });
    const manifestBytes = Uint8Array.from(
      atob(await serializeCanvasManifest(document)),
      (char) => char.charCodeAt(0),
    );
    mocks.extractPdfDocument.mockResolvedValue({ pages: [], manifestBytes });

    const result = await importPdfFile(
      new File(['%PDF'], 'round-trip-image.pdf', { type: 'application/pdf' }),
    );

    expect(get).toHaveBeenCalledWith('canvas-asset:abc123');
    expect(result.fragment.layers.find((layer) => layer.type === 'image')?.value).toMatch(/^blob:/);
    expect(mocks.mapPdfPagesToCanvas).not.toHaveBeenCalled();
  });

  it('limits preflight page inspection to the import page budget', async () => {
    const pages = Array.from({ length: 100 }, () => ({
      getViewport: () => ({ width: 612, height: 792 }),
      cleanup: vi.fn(),
    }));
    const pdf = {
      numPages: pages.length,
      getPage: vi.fn(async (pageNumber: number) => pages[pageNumber - 1]),
      cleanup: vi.fn(async () => undefined),
      destroy: vi.fn(async () => undefined),
    };
    mocks.ensurePdfJs.mockResolvedValue({
      getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
    });

    const result = await (await import('../importPdf')).inspectPdfFile(
      new File(['%PDF'], 'large-page-count.pdf', { type: 'application/pdf' }),
    );

    expect(result.pageCount).toBe(100);
    expect(result.pageSizes).toHaveLength(50);
    expect(pdf.getPage).toHaveBeenCalledTimes(50);
  });

  it('falls back to visual extraction when a manifest image has no usable asset reference', async () => {
    const document = createEmptyDocument('Image fallback');
    document.layers.push({
      id: 'manifest-image',
      type: 'image',
      name: 'Missing image asset',
      value: '',
      pageIndex: 0,
      cssVars: {
        '--width': '10mm',
        '--height': '10mm',
        '--translate-x': '0mm',
        '--translate-y': '0mm',
      },
    });
    const manifestBytes = Uint8Array.from(
      atob(await serializeCanvasManifest(document)),
      (char) => char.charCodeAt(0),
    );
    const fallbackFragment = {
      pages: [{ id: 'p1', name: 'PDF Página 1' }],
      layers: [],
      fields: [],
      firstPageIndex: 0,
      importedLayerIds: [],
      report: { importedCount: 0, skippedCount: 0, pagesProcessed: 1, issues: [], warnings: [] },
    };
    mocks.extractPdfDocument.mockResolvedValue({
      pages: [{ pageNumber: 1, widthPt: 612, heightPt: 792, operators: 0, primitives: [], warnings: [] }],
      manifestBytes,
    });
    mocks.mapPdfPagesToCanvas.mockReturnValue(fallbackFragment);

    const result = await importPdfFile(new File(['%PDF'], 'image-fallback.pdf', { type: 'application/pdf' }));

    expect(mocks.mapPdfPagesToCanvas).toHaveBeenCalledOnce();
    expect(result.fragment).toMatchObject({
      pages: fallbackFragment.pages,
      importedLayerIds: fallbackFragment.importedLayerIds,
      report: expect.objectContaining({ warnings: expect.arrayContaining([
        'El manifiesto Canvas no pudo usarse; se aplicó importación heurística',
      ]) }),
    });
    expect(result.report.warnings).toContain('El manifiesto Canvas no pudo usarse; se aplicó importación heurística');
  });
});
