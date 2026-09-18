import { describe, expect, it, vi } from 'vitest';

const getDocument = vi.fn();
const ensurePdfJs = vi.fn();

vi.mock('../../lib/pdfjs', () => ({
  ensurePdfJs: () => ensurePdfJs(),
}));

import { getPdfPageSize, loadPdfDocument, renderPdfPageToDataUrl } from './pdfjs';

const b64 = 'QUJD'; // "ABC" en base64

function fakePage(width: number, height: number) {
  return {
    getViewport: ({ scale }: { scale: number }) => ({
      width: width * scale,
      height: height * scale,
      scale,
    }),
    render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
  };
}

function fakePdf(width = 612, height = 792) {
  return { getPage: vi.fn().mockResolvedValue(fakePage(width, height)) };
}

describe('sellador/pdfjs', () => {
  it('loadPdfDocument decodifica base64 y pide el documento a pdfjs', async () => {
    const pdf = fakePdf();
    getDocument.mockReturnValue({ promise: Promise.resolve(pdf) });
    ensurePdfJs.mockResolvedValue({ getDocument });
    const out = await loadPdfDocument(b64);
    expect(out).toBe(pdf);
    expect(getDocument).toHaveBeenCalledWith({ data: expect.any(Uint8Array) });
  });

  it('getPdfPageSize devuelve el tamaño sin escalar de la página pedida', async () => {
    const pdf = fakePdf(300, 400);
    getDocument.mockReturnValue({ promise: Promise.resolve(pdf) });
    ensurePdfJs.mockResolvedValue({ getDocument });
    const size = await getPdfPageSize(b64, 2);
    expect(pdf.getPage).toHaveBeenCalledWith(2);
    expect(size).toEqual({ width: 300, height: 400 });
  });

  it('renderPdfPageToDataUrl clampa el scale entre MIN y MAX pixel width', async () => {
    const page = fakePage(200, 100);
    const pdf = { getPage: vi.fn().mockResolvedValue(page) };

    const ctx = { fillStyle: '', fillRect: vi.fn() };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(ctx),
      toDataURL: vi.fn().mockReturnValue('data:image/png;base64,xyz'),
    };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);

    const out = await renderPdfPageToDataUrl(pdf as never, 1, 500, 2);
    expect(out.url).toBe('data:image/png;base64,xyz');
    expect(out.pageSize).toEqual({ width: 200, height: 100 });
    expect(page.render).toHaveBeenCalledWith(
      expect.objectContaining({ canvasContext: ctx }),
    );
    vi.restoreAllMocks();
  });

  it('renderPdfPageToDataUrl nunca escala por debajo del mínimo de preview', async () => {
    // página muy ancha respecto al contenedor → scale bajo → clamp a MIN
    const page = fakePage(5000, 100);
    const pdf = { getPage: vi.fn().mockResolvedValue(page) };
    const ctx = { fillStyle: '', fillRect: vi.fn() };
    const canvas = {
      width: 0, height: 0,
      getContext: vi.fn().mockReturnValue(ctx),
      toDataURL: vi.fn().mockReturnValue('data:x'),
    };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);

    await renderPdfPageToDataUrl(pdf as never, 1, 100, 1);
    const viewport = page.render.mock.calls[0][0].viewport;
    // MIN_PREVIEW_PIXEL_WIDTH=900 → viewport.width clampa a 900
    expect(viewport.width).toBe(900);
    vi.restoreAllMocks();
  });
});
