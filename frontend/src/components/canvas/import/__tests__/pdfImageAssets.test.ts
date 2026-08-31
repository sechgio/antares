import { afterEach, describe, expect, it, vi } from 'vitest';
import { persistPdfImage } from '../pdfImageAssets';
import { mapPdfPagesToCanvasWithAssets } from '../importPdf';

describe('PDF image assets', () => {
  afterEach(() => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = undefined;
  });

  it('persists bytes through the Canvas asset store', async () => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      canvasAssetPut: vi.fn().mockResolvedValue({ ref: 'canvas-asset:abc' }),
    };
    const result = await persistPdfImage({
      key: 'img-1',
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      widthPx: 10,
      heightPx: 10,
    });
    expect(window.electronAPI?.canvasAssetPut).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    expect(result).toMatch(/^blob:/);
  });

  it('keeps a live blob when the asset bridge is unavailable', async () => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = undefined;
    const result = await persistPdfImage({
      key: 'img-2',
      bytes: new Uint8Array([1]),
      mimeType: 'image/png',
      widthPx: 1,
      heightPx: 1,
    });
    expect(result).toMatch(/^blob:/);
  });

  it('rejects encoded image formats that the Canvas asset store cannot render', async () => {
    await expect(persistPdfImage({
      key: 'img-jpx',
      bytes: new Uint8Array([1]),
      mimeType: 'image/jpx',
      widthPx: 1,
      heightPx: 1,
    })).rejects.toThrow('Tipo de imagen PDF no soportado');
  });

  it('keeps the live blob URL on the imported layer after persistence', async () => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      canvasAssetPut: vi.fn().mockResolvedValue({ ref: 'canvas-asset:abc' }),
    };
    const fragment = await mapPdfPagesToCanvasWithAssets([
      {
        pageNumber: 1,
        widthPt: 612,
        heightPt: 792,
        operators: 1,
        warnings: [],
        primitives: [{
          kind: 'image',
          box: { x: 0, y: 0, width: 100, height: 100 },
          asset: {
            key: 'image-1',
            bytes: new Uint8Array([1, 2, 3]),
            mimeType: 'image/png',
            widthPx: 1,
            heightPx: 1,
          },
        }],
      },
    ]);

    expect(fragment.layers.find((layer) => layer.type === 'image')?.value).toMatch(/^blob:/);
  });
});
