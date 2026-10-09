import { describe, expect, it, vi } from 'vitest';

const getDocument = vi.fn();
const ensurePdfJs = vi.fn();

vi.mock('../../lib/pdfjs', () => ({
  ensurePdfJs: () => ensurePdfJs(),
}));

import { loadPdfDocument, renderPdfPageToCanvas, renderPdfPageToDataUrl } from './pdfjs';
import * as previewDpi from './previewDpi';

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
  return { getPage: vi.fn().mockResolvedValue(fakePage(width, height)), destroy: vi.fn(async () => {}) };
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
    expect(canvas.width).toBe(1000);
    expect(canvas.height).toBe(500);
    expect(ctx.fillStyle).toBe('#ffffff');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1000, 500);
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/png');
    expect(page.render).toHaveBeenCalledWith(
      expect.objectContaining({ canvasContext: ctx }),
    );
    vi.restoreAllMocks();
  });

  it('renderPdfPageToDataUrl nunca escala por debajo del mínimo de preview', async () => {
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
    expect(viewport.width).toBe(900);
    vi.restoreAllMocks();
  });

  it('limita el canvas a 2048 píxeles y conserva la escala para componer sellos', async () => {
    const page = fakePage(200, 100);
    const pdf = { getPage: vi.fn().mockResolvedValue(page) };
    const ctx = { fillStyle: '', fillRect: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: vi.fn().mockReturnValue(ctx) };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);

    try {
      const out = await renderPdfPageToCanvas(pdf as never, 2, 2000, 3);
      expect(pdf.getPage).toHaveBeenCalledWith(2);
      expect(out.canvas).toBe(canvas);
      expect(out.ctx).toBe(ctx);
      expect(canvas.width).toBe(2048);
      expect(canvas.height).toBe(1024);
      expect(out.pxScale).toBe(2048 / 200);
      expect(out.pageSize).toEqual({ width: 200, height: 100 });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('lee el DPR del Sellador después de cargar la página', async () => {
    const dpr = vi.spyOn(previewDpi, 'selladorPreviewDpr').mockReturnValue(1.5);
    const page = fakePage(200, 100);
    const pdf = { getPage: vi.fn(async () => { dpr.mockReturnValue(3); return page; }) };
    const ctx = { fillStyle: '', fillRect: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: vi.fn().mockReturnValue(ctx) };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);

    try {
      const out = await renderPdfPageToCanvas(pdf as never, 2, 500);
      expect(canvas.width).toBe(1500);
      expect(out.pxScale).toBe(7.5);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
