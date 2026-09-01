import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractPdfDocument } from '../pdfExtract';

const pdfjsMock = vi.hoisted(() => ({
  ensurePdfJs: vi.fn(),
}));

vi.mock('../../../../lib/pdfjs', () => pdfjsMock);

function makePage(pageNumber: number, overLimit = false) {
  return {
    getViewport: () => ({ width: 612, height: 792 }),
    getOperatorList: vi.fn(async () => ({
      fnArray: overLimit ? [1, 2] : pageNumber === 1 ? [1, 2] : [],
      argsArray: overLimit ? [[72, 600, 100, 40], []] : pageNumber === 1 ? [[72, 600, 100, 40], []] : [],
    })),
    getTextContent: vi.fn(async () =>
      pageNumber === 1
        ? {
            items: [
              {
                str: 'Hola',
                transform: [12, 0, 0, 12, 72, 700],
                width: 50,
                height: 12,
                fontName: 'f1',
              },
            ],
            styles: { f1: { fontFamily: 'Helvetica' } },
          }
        : { items: [], styles: {} },
    ),
    getAnnotations: vi.fn(async () =>
      pageNumber === 2
        ? [{ subtype: 'Widget', fieldType: 'Btn', checkBox: true, fieldValue: 'Yes', rect: [72, 500, 84, 512] }]
        : [],
    ),
    cleanup: vi.fn(),
  };
}

function configurePdf(overLimit = false) {
  const pages = [makePage(1, overLimit), makePage(2)];
  const pdf = {
    numPages: pages.length,
    getPage: vi.fn(async (pageNumber: number) => pages[pageNumber - 1]),
    getAttachments: vi.fn(async () => null),
    cleanup: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
  };
  pdfjsMock.ensurePdfJs.mockResolvedValue({
    OPS: { rectangle: 1, fill: 2 },
    getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
  });
  return pdf;
}

describe('extractPdfDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts pages in order and emits progress', async () => {
    const pdf = configurePdf();
    const progress: number[] = [];
    const result = await extractPdfDocument(new Uint8Array([37, 80, 68, 70]), {
      onProgress: (value) => progress.push(value.page),
    });

    expect(result.pages).toHaveLength(2);
    expect(pdf.getPage).toHaveBeenCalledWith(1);
    expect(pdf.getPage).toHaveBeenCalledWith(2);
    expect(progress).toEqual([1, 2]);
    expect(result.pages[0]!.primitives.some((item) => item.kind === 'text')).toBe(true);
    expect(result.pages[0]!.primitives.some((item) => item.kind === 'rect')).toBe(true);
    expect(result.pages[1]!.primitives.some((item) => item.kind === 'checkbox')).toBe(true);
  });

  it('stops before the next page after cancellation', async () => {
    const pdf = configurePdf();
    const controller = new AbortController();
    const result = extractPdfDocument(new Uint8Array([1]), {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(pdf.getPage).toHaveBeenCalledTimes(1);
  });

  it('releases the PDF document when the requested page range is invalid', async () => {
    const pdf = configurePdf();

    await expect(extractPdfDocument(new Uint8Array([1]), { pageStart: 2, pageEnd: 1 })).rejects.toThrow('Rango de páginas inválido');

    expect(pdf.cleanup).toHaveBeenCalledOnce();
    expect(pdf.destroy).toHaveBeenCalledOnce();
  });

  it('does not vectorize a page that exceeds the operator budget', async () => {
    configurePdf(true);
    const result = await extractPdfDocument(new Uint8Array([1]), {
      pageStart: 1,
      pageEnd: 1,
      limits: { maxOperatorsPerPage: 1 },
    });

    expect(result.pages[0]!.primitives).toEqual([]);
    expect(result.pages[0]!.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'limit-exceeded', count: 1 }),
      ]),
    );
  });

  it('resolves PDF.js image objects with their owning object store', async () => {
    const image = {
      width: 2,
      height: 2,
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3, 4]),
    };
    const values = new Map([['image-1', image]]);
    const page = {
      ...makePage(1),
      getOperatorList: vi.fn(async () => ({ fnArray: [3], argsArray: [['image-1']] })),
      objs: {
        get(id: string) {
          return values.get(id);
        },
      },
    };
    const pdf = {
      numPages: 1,
      getPage: vi.fn(async () => page),
      getAttachments: vi.fn(async () => null),
      cleanup: vi.fn(async () => undefined),
      destroy: vi.fn(async () => undefined),
    };
    pdfjsMock.ensurePdfJs.mockResolvedValue({
      OPS: { paintImageXObject: 3 },
      getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
    });

    const result = await extractPdfDocument(new Uint8Array([1]));

    expect(result.pages[0]!.primitives).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'image', asset: expect.objectContaining({ bytes: image.bytes }) })]),
    );
  });

  it('caps image extraction per page before creating editable primitives', async () => {
    const image = {
      width: 2,
      height: 2,
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3, 4]),
    };
    const page = {
      ...makePage(1),
      getOperatorList: vi.fn(async () => ({
        fnArray: [3, 3],
        argsArray: [['image-1'], ['image-2']],
      })),
      objs: {
        get: vi.fn(() => image),
      },
    };
    const pdf = {
      numPages: 1,
      getPage: vi.fn(async () => page),
      getAttachments: vi.fn(async () => null),
      cleanup: vi.fn(async () => undefined),
      destroy: vi.fn(async () => undefined),
    };
    pdfjsMock.ensurePdfJs.mockResolvedValue({
      OPS: { paintImageXObject: 3 },
      getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
    });

    const result = await extractPdfDocument(new Uint8Array([1]), {
      limits: { maxImagesPerPage: 1 },
    });

    expect(result.pages[0]!.primitives.filter((item) => item.kind === 'image')).toHaveLength(1);
    expect(result.pages[0]!.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'limit-exceeded', message: 'La página supera el límite de imágenes', count: 1 }),
      ]),
    );
  });

  it('skips heuristic page extraction when the manifest can be used', async () => {
    const manifestBytes = new Uint8Array([123, 125]);
    const page = makePage(1);
    const pdf = {
      numPages: 1,
      getPage: vi.fn(async () => page),
      getAttachments: vi.fn(async () => ({
        'antares-canvas-manifest.json': { filename: 'antares-canvas-manifest.json', content: manifestBytes },
      })),
      cleanup: vi.fn(async () => undefined),
      destroy: vi.fn(async () => undefined),
    };
    pdfjsMock.ensurePdfJs.mockResolvedValue({
      OPS: {},
      getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
    });
    const onManifest = vi.fn(async () => true);

    const result = await extractPdfDocument(new Uint8Array([1]), { onManifest });

    expect(onManifest).toHaveBeenCalledWith(manifestBytes);
    expect(result.pages).toEqual([]);
    expect(result.manifestBytes).toEqual(manifestBytes);
    expect(pdf.getPage).not.toHaveBeenCalled();
  });
});
