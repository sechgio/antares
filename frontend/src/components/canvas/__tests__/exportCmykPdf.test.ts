import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../api';
import { exportCanvasPdf } from '../export/exportPdf';
import { createEmptyDocument, newId } from '../types';
import type { FillContext } from '../runtime/renderHtml';

vi.mock('../../../api', () => ({
  api: {
    htmlToPdf: vi.fn(),
    canvasExportCmykPdf: vi.fn(),
  },
}));

const prepareDocumentImagesForExport = vi.fn(async (doc: unknown) => doc);
const serializeDocumentImages = vi.fn(async (doc: unknown) => doc);

vi.mock('../utils/imageBlobStore', () => ({
  prepareDocumentImagesForExport: (...args: unknown[]) =>
    prepareDocumentImagesForExport(...args),
  serializeDocumentImages: (...args: unknown[]) => serializeDocumentImages(...args),
}));

function emptyCtx(images: string[] = []): FillContext {
  return { data: {}, images, logoLeft: null, logoRight: null };
}

describe('exportCanvasPdf with CMYK color mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prepareDocumentImagesForExport.mockImplementation(async (doc: unknown) => doc);
  });

  it('prepares document images before RGB htmlToPdf', async () => {
    const doc = createEmptyDocument('Test RGB');
    (api.htmlToPdf as ReturnType<typeof vi.fn>).mockResolvedValue({
      filename: 'doc.pdf',
      saved_path: '/path/doc.pdf',
    });

    await exportCanvasPdf({
      document: doc,
      contexts: [emptyCtx()],
      filename: 'doc.pdf',
      colorMode: 'rgb',
    });

    expect(prepareDocumentImagesForExport).toHaveBeenCalledWith(doc, { mode: 'rgb' });
    expect(serializeDocumentImages).toHaveBeenCalledWith(doc, { preferAssetRefs: true });
    expect(api.htmlToPdf).toHaveBeenCalled();
  });

  it('prepares document images before CMYK export', async () => {
    const doc = createEmptyDocument('Test CMYK');
    (api.canvasExportCmykPdf as ReturnType<typeof vi.fn>).mockResolvedValue({
      filename: 'cmyk.pdf',
      saved_path: '/path/cmyk.pdf',
    });

    await exportCanvasPdf({
      document: doc,
      contexts: [emptyCtx()],
      filename: 'cmyk.pdf',
      colorMode: 'cmyk',
    });

    expect(prepareDocumentImagesForExport).toHaveBeenCalledWith(doc, { mode: 'cmyk' });
    expect(serializeDocumentImages).toHaveBeenCalledWith(doc, { preferAssetRefs: true });
    expect(api.canvasExportCmykPdf).toHaveBeenCalled();
  });

  it('calls api.htmlToPdf when colorMode is "rgb" or omitted', async () => {
    const doc = createEmptyDocument('Test RGB');
    (api.htmlToPdf as ReturnType<typeof vi.fn>).mockResolvedValue({
      filename: 'doc.pdf',
      saved_path: '/path/doc.pdf',
    });

    const result = await exportCanvasPdf({
      document: doc,
      contexts: [emptyCtx()],
      filename: 'doc.pdf',
      colorMode: 'rgb',
    });

    expect(api.htmlToPdf).toHaveBeenCalled();
    expect(api.canvasExportCmykPdf).not.toHaveBeenCalled();
    expect(result.saved_path).toBe('/path/doc.pdf');
  });

  it('calls api.canvasExportCmykPdf when colorMode is "cmyk"', async () => {
    const doc = createEmptyDocument('Test CMYK');
    (api.canvasExportCmykPdf as ReturnType<typeof vi.fn>).mockResolvedValue({
      filename: 'cmyk_doc.pdf',
      saved_path: '/path/cmyk_doc.pdf',
    });

    const result = await exportCanvasPdf({
      document: doc,
      contexts: [emptyCtx()],
      filename: 'cmyk_doc.pdf',
      colorMode: 'cmyk',
      colorProfile: 'cmyk_iso_coated_v2',
      bleedMm: 3.0,
      showCropMarks: true,
    });

    expect(api.canvasExportCmykPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        color_profile: 'cmyk_iso_coated_v2',
        bleed_mm: 3.0,
        show_crop_marks: true,
        filename: 'cmyk_doc.pdf',
        pair_context_pages: true,
      }),
    );
    expect(api.htmlToPdf).not.toHaveBeenCalled();
    expect(result.saved_path).toBe('/path/cmyk_doc.pdf');
  });

  it('CMYK expands 4-slot doc + 9 images into 3 paired photo pages', async () => {
    const doc = createEmptyDocument('CMYK slots');
    for (let i = 0; i < 4; i += 1) {
      doc.layers.push({
        id: newId(),
        type: 'imageSlot',
        name: `Foto ${i + 1}`,
        value: '',
        pageIndex: 0,
        meta: { index: i },
        cssVars: {
          '--width': '40mm',
          '--height': '40mm',
          '--translate-x': '0mm',
          '--translate-y': '0mm',
        },
      });
    }
    (api.canvasExportCmykPdf as ReturnType<typeof vi.fn>).mockResolvedValue({
      filename: 'photos.pdf',
      saved_path: '/path/photos.pdf',
    });

    await exportCanvasPdf({
      document: doc,
      contexts: [emptyCtx(Array.from({ length: 9 }, (_, i) => `img-${i}`))],
      filename: 'photos.pdf',
      colorMode: 'cmyk',
    });

    expect(api.canvasExportCmykPdf).toHaveBeenCalledTimes(1);
    const body = (api.canvasExportCmykPdf as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      document: { pages?: unknown[]; layers: Array<{ pageIndex?: number; type: string }> };
      contexts: Array<{ images: string[] }>;
      pair_context_pages?: boolean;
    };
    expect(body.pair_context_pages).toBe(true);
    expect(body.contexts).toHaveLength(3);
    expect(body.contexts[0]!.images).toEqual(['img-0', 'img-1', 'img-2', 'img-3']);
    expect(body.contexts[1]!.images).toEqual(['img-4', 'img-5', 'img-6', 'img-7']);
    expect(body.contexts[2]!.images).toEqual(['img-8']);
    expect(body.document.pages).toHaveLength(3);
    for (let p = 0; p < 3; p += 1) {
      const slots = body.document.layers.filter(
        (l) => l.type === 'imageSlot' && (l.pageIndex ?? 0) === p,
      );
      expect(slots).toHaveLength(4);
    }
  });
});
