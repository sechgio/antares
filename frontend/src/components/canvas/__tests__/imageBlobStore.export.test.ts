import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertCanvasAssetExpansionWithinBytes,
  clearBlobStore,
} from '../utils/imageBlobStore';
import { createEmptyDocument } from '../types';

describe('imageBlobStore export', () => {
  afterEach(() => {
    clearBlobStore();
    (window as unknown as { electronAPI?: unknown }).electronAPI = undefined;
  });

  it('prepareDocumentImagesForExport expands assets and managed blobs to data URLs', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const get = vi.fn(async (ref: string) => {
      if (ref !== 'canvas-asset:abc') throw new Error('not found');
      return {
        chunk: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
        ref,
        bytes: 4,
      };
    });
    (window as unknown as { electronAPI: { canvasAssetGet: typeof get } }).electronAPI = {
      canvasAssetGet: get,
    };

    const {
      prepareDocumentImagesForExport,
      embedCanvasAssetsAsDataUrls,
    } = await import('../utils/imageBlobStore');

    const doc = createEmptyDocument('Export');
    doc.layers.push({
      id: 'img1',
      type: 'image',
      name: 'Asset',
      value: 'canvas-asset:abc',
      cssVars: { '--width': '10mm', '--height': '10mm', '--translate-x': '0mm', '--translate-y': '0mm' },
    });
    const prepared = await prepareDocumentImagesForExport(doc);
    const img = prepared.layers.find((l) => l.id === 'img1');
    expect(img?.value).toMatch(/^data:/);
    expect(get).toHaveBeenCalledWith('canvas-asset:abc');

    await expect(
      embedCanvasAssetsAsDataUrls(
        {
          ...doc,
          layers: doc.layers.map((l) =>
            l.id === 'img1' ? { ...l, value: 'canvas-asset:missing' } : l,
          ),
        },
        { strict: true },
      ),
    ).rejects.toThrow(/No se pudo resolver|not found/);
  });

  it('embeds each repeated canvas asset only once per export', async () => {
    const png = new Uint8Array([1, 2, 3, 4]);
    const get = vi.fn(async () => ({
      chunk: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
      ref: 'canvas-asset:repeated',
      bytes: png.byteLength,
    }));
    (window as unknown as { electronAPI: { canvasAssetGet: typeof get } }).electronAPI = {
      canvasAssetGet: get,
    };

    const doc = createEmptyDocument('Repeated export asset');
    const cssVars = {
      '--width': '10mm',
      '--height': '10mm',
      '--translate-x': '0mm',
      '--translate-y': '0mm',
    };
    doc.layers.push(
      { id: 'img-a', type: 'image', name: 'A', value: 'canvas-asset:repeated', cssVars },
      { id: 'img-b', type: 'logo', name: 'B', value: 'canvas-asset:repeated', cssVars },
    );

    const embedded = await (await import('../utils/imageBlobStore')).embedCanvasAssetsAsDataUrls(doc, { strict: true });
    expect(get).toHaveBeenCalledOnce();
    expect(embedded.layers.find((layer) => layer.id === 'img-b')?.value).toBe(
      embedded.layers.find((layer) => layer.id === 'img-a')?.value,
    );
  });

  it('checks asset metadata before expanding an oversized cloud document', async () => {
    const info = vi.fn(async () => ({
      ref: 'canvas-asset:large',
      asset_id: 'large',
      bytes: 8_000,
    }));
    const get = vi.fn(async () => ({
      ref: 'canvas-asset:large',
      chunk: new ArrayBuffer(8_000),
      bytes: 8_000,
    }));
    (window as unknown as {
      electronAPI: { canvasAssetInfo: typeof info; canvasAssetGet: typeof get };
    }).electronAPI = { canvasAssetInfo: info, canvasAssetGet: get };

    const doc = createEmptyDocument('Oversized cloud asset');
    doc.layers.push({
      id: 'large-image',
      type: 'image',
      name: 'Large',
      value: 'canvas-asset:large',
      cssVars: { '--width': '10mm', '--height': '10mm', '--translate-x': '0mm', '--translate-y': '0mm' },
    });

    await expect(assertCanvasAssetExpansionWithinBytes(doc, 1_024)).rejects.toThrow(/16 MiB/);
    expect(info).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects when asset metadata reports a non-numeric byte size', async () => {
    const info = vi.fn(async () => ({
      ref: 'canvas-asset:opaque',
      asset_id: 'opaque',
      bytes: undefined as unknown as number,
    }));
    (window as unknown as {
      electronAPI: { canvasAssetInfo: typeof info };
    }).electronAPI = { canvasAssetInfo: info };

    const doc = createEmptyDocument('Opaque asset');
    doc.layers.push({
      id: 'opaque-image',
      type: 'image',
      name: 'Opaque',
      value: 'canvas-asset:opaque',
      cssVars: { '--width': '10mm', '--height': '10mm', '--translate-x': '0mm', '--translate-y': '0mm' },
    });

    await expect(assertCanvasAssetExpansionWithinBytes(doc, 64 * 1024 * 1024))
      .rejects.toThrow(/asset Canvas/);
  });

  it('prepareDocumentImagesForExport cmyk mode keeps canvas-asset refs (no data: inflate)', async () => {
    const put = vi.fn(async () => ({ ref: 'canvas-asset:fromdata', asset_id: 'fromdata', bytes: 4 }));
    (window as unknown as { electronAPI: { canvasAssetPut: typeof put } }).electronAPI = {
      canvasAssetPut: put,
    };

    const { prepareDocumentImagesForExport } = await import('../utils/imageBlobStore');
    const doc = createEmptyDocument('CMYK export');
    doc.layers.push({
      id: 'img1',
      type: 'image',
      name: 'Asset',
      value: 'canvas-asset:keepme',
      cssVars: { '--width': '10mm', '--height': '10mm', '--translate-x': '0mm', '--translate-y': '0mm' },
    });
    doc.layers.push({
      id: 'img2',
      type: 'image',
      name: 'Inline',
      value: 'data:image/png;base64,iVBORw0KGgo=',
      cssVars: { '--width': '10mm', '--height': '10mm', '--translate-x': '0mm', '--translate-y': '0mm' },
    });

    const prepared = await prepareDocumentImagesForExport(doc, { mode: 'cmyk' });
    expect(prepared.layers.find((l) => l.id === 'img1')?.value).toBe('canvas-asset:keepme');
    expect(prepared.layers.find((l) => l.id === 'img2')?.value).toBe('canvas-asset:fromdata');
    expect(put).toHaveBeenCalled();
  });
});
