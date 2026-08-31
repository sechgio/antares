import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applySavedDocumentKeepingImages,
  clearBlobStore,
  collectImageRefsFromLayers,
  getBlobUrl,
  getThumbnailUrl,
  hydrateDocumentImages,
  registerImageBlob,
  releaseImageBlob,
  serializeDocumentImages,
  sweepOrphanBlobs,
} from '../utils/imageBlobStore';
import { createEmptyDocument } from '../types';

describe('imageBlobStore', () => {
  afterEach(() => {
    clearBlobStore();
    (window as unknown as { electronAPI?: unknown }).electronAPI = undefined;
  });

  it('registers a Blob and generates an ObjectURL', async () => {
    const fakeBlob = new Blob(['fake image content'], { type: 'image/png' });
    const registered = await registerImageBlob(fakeBlob);

    expect(registered.blobId).toMatch(/^img_blob_/);
    expect(registered.url).toMatch(/^blob:/);
    expect(getBlobUrl(registered.blobId)).toBe(registered.url);
    expect(getThumbnailUrl(registered.blobId)).toBeDefined();
  });

  it('releases a registered blob by url and by blobId', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const byUrl = await registerImageBlob(new Blob(['a'], { type: 'image/png' }));
    const byId = await registerImageBlob(new Blob(['b'], { type: 'image/png' }));

    releaseImageBlob(byUrl.url);
    expect(getBlobUrl(byUrl.blobId)).toBe(byUrl.blobId);
    expect(revokeSpy).toHaveBeenCalledWith(byUrl.url);

    releaseImageBlob(byId.blobId);
    expect(getBlobUrl(byId.blobId)).toBe(byId.blobId);
    expect(revokeSpy).toHaveBeenCalledWith(byId.url);

    revokeSpy.mockRestore();
  });

  it('hydrates base64 image layers without decoding (keeps dataUrl for direct render)', async () => {
    const doc = createEmptyDocument('Test Doc');
    const base64Data =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA****************************************************************Jggg==';

    doc.layers.push({
      id: 'img1',
      type: 'image',
      name: 'Foto',
      value: base64Data,
      cssVars: {
        '--width': '50mm',
        '--height': '40mm',
        '--translate-x': '0mm',
        '--translate-y': '0mm',
      },
    });

    const hydrated = await hydrateDocumentImages(doc);
    const imgLayer = hydrated.layers.find((l) => l.id === 'img1');

    expect(imgLayer).toBeDefined();
    expect(imgLayer?.value).toBe(base64Data);
    // Renderers fall back to the raw value, so a dataUrl is directly displayable.
    expect(getBlobUrl(imgLayer?.value)).toBe(base64Data);
  });

  it('strict hydration rejects a missing persisted canvas asset', async () => {
    const get = vi.fn(async () => {
      throw new Error('asset not found');
    });
    (window as unknown as { electronAPI: { canvasAssetGet: typeof get } }).electronAPI = {
      canvasAssetGet: get,
    };
    const doc = createEmptyDocument('Remote');
    doc.layers.push({
      id: 'missing-image',
      type: 'image',
      name: 'Missing',
      value: 'canvas-asset:missing',
      cssVars: {
        '--width': '10mm',
        '--height': '10mm',
        '--translate-x': '0mm',
        '--translate-y': '0mm',
      },
    });

    const hydrate = hydrateDocumentImages as unknown as (
      document: typeof doc,
      options?: { strict?: boolean },
    ) => Promise<typeof doc>;
    await expect(hydrate(doc, { strict: true })).rejects.toThrow(/asset|resolver|not found/i);
  });

  it('serializes ObjectURL layers back to persistent DataURLs when asset API missing', async () => {
    const fakeBlob = new Blob(['test content'], { type: 'image/png' });
    const registered = await registerImageBlob(fakeBlob);

    const doc = createEmptyDocument('Doc');
    doc.layers.push({
      id: 'img1',
      type: 'image',
      name: 'Foto Blob',
      value: registered.url,
      cssVars: {
        '--width': '50mm',
        '--height': '40mm',
        '--translate-x': '0mm',
        '--translate-y': '0mm',
      },
    });

    const serialized = await serializeDocumentImages(doc);
    const imgLayer = serialized.layers.find((l) => l.id === 'img1');

    expect(imgLayer).toBeDefined();
    expect(imgLayer?.value).toMatch(/^data:/);
    // Registered blob must not retain the dataUrl copy after serialize.
    expect(registered.dataUrl).toBeUndefined();
  });

  it('serializes ObjectURL layers to canvas-asset refs when Electron API is available', async () => {
    const put = vi.fn(async () => ({ ref: 'canvas-asset:abc123', asset_id: 'abc123', bytes: 4 }));
    (window as unknown as { electronAPI: { canvasAssetPut: typeof put } }).electronAPI = {
      canvasAssetPut: put,
    };

    const fakeBlob = new Blob(['test content'], { type: 'image/png' });
    const registered = await registerImageBlob(fakeBlob);
    const doc = createEmptyDocument('Doc');
    doc.layers.push({
      id: 'img1',
      type: 'image',
      name: 'Foto',
      value: registered.url,
      cssVars: {
        '--width': '50mm',
        '--height': '40mm',
        '--translate-x': '0mm',
        '--translate-y': '0mm',
      },
    });

    const serialized = await serializeDocumentImages(doc);
    expect(serialized.layers.find((l) => l.id === 'img1')?.value).toBe('canvas-asset:abc123');
    expect(put).toHaveBeenCalledOnce();
  });

  it('serializeHistorySteps persists blob image values in diff steps', async () => {
    const put = vi.fn(async () => ({ ref: 'canvas-asset:hist1', asset_id: 'hist1', bytes: 3 }));
    (window as unknown as { electronAPI: { canvasAssetPut: typeof put } }).electronAPI = {
      canvasAssetPut: put,
    };
    const {
      serializeHistorySteps,
      hydrateHistorySteps,
      registerImageBlob,
      clearBlobStore,
    } = await import('../utils/imageBlobStore');

    const reg = await registerImageBlob(new Blob(['abc'], { type: 'image/png' }));
    const steps = [
      {
        type: 'diff' as const,
        undoDiff: {},
        redoDiff: {
          addedLayers: [
            {
              id: 'img-h',
              type: 'image' as const,
              name: 'Foto',
              value: reg.url,
              cssVars: {
                '--width': '10mm',
                '--height': '10mm',
                '--translate-x': '0mm',
                '--translate-y': '0mm',
              },
            },
          ],
        },
      },
    ];

    const serialized = await serializeHistorySteps(steps);
    expect(serialized[0]).toMatchObject({
      type: 'diff',
      redoDiff: { addedLayers: [{ id: 'img-h', value: 'canvas-asset:hist1' }] },
    });
    expect(put).toHaveBeenCalled();

    const png = new Uint8Array([1, 2, 3]);
    const get = vi.fn(async () => ({
      chunk: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
      ref: 'canvas-asset:hist1',
      bytes: 3,
    }));
    (window as unknown as { electronAPI: { canvasAssetGet: typeof get } }).electronAPI = {
      canvasAssetGet: get,
    };
    clearBlobStore();
    const hydrated = await hydrateHistorySteps(serialized);
    const val = (hydrated[0] as { redoDiff: { addedLayers: Array<{ value: string }> } }).redoDiff
      .addedLayers[0]?.value;
    expect(val).toMatch(/^blob:/);
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

  it('roundtrips blob URL and blobId through serialize then hydrate', async () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const reg = await registerImageBlob(file);
    const css = {
      '--width': '50mm',
      '--height': '40mm',
      '--translate-x': '0mm',
      '--translate-y': '0mm',
    };
    const doc = createEmptyDocument('Roundtrip');
    doc.layers = [
      { id: 'img', type: 'image', name: 'Foto', value: reg.url, cssVars: css },
      { id: 'logo', type: 'logo', name: 'Logo', value: reg.blobId, cssVars: css },
    ];

    const serialized = await serializeDocumentImages(doc);
    for (const layer of serialized.layers.filter((l) => l.type === 'image' || l.type === 'logo')) {
      expect(layer.value).toMatch(/^data:(image\/|;)/);
      expect(layer.value).not.toContain('blob:');
    }

    const hydrated = await hydrateDocumentImages(serialized);
    for (const layer of hydrated.layers.filter((l) => l.type === 'image' || l.type === 'logo')) {
      // Hydrate is now a startup fast-path: images stay as the persistent
      // dataUrl (renderers fall back to the raw value) instead of being
      // re-decoded to blob: on the main thread.
      expect(layer.value).toMatch(/^data:/);
    }
  });

  it('sweepOrphanBlobs revokes ObjectURLs not referenced by live layers', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const keep = await registerImageBlob(new Blob(['keep'], { type: 'image/png' }));
    const drop = await registerImageBlob(new Blob(['drop'], { type: 'image/png' }));

    const doc = createEmptyDocument('Sweep');
    doc.layers.push({
      id: 'img1',
      type: 'image',
      name: 'Keep',
      value: keep.url,
      cssVars: {
        '--width': '50mm',
        '--height': '40mm',
        '--translate-x': '0mm',
        '--translate-y': '0mm',
      },
    });

    const live = collectImageRefsFromLayers(doc.layers);
    expect(sweepOrphanBlobs(live)).toBe(1);
    expect(getBlobUrl(keep.blobId)).toBe(keep.url);
    expect(getBlobUrl(drop.blobId)).toBe(drop.blobId);
    expect(revokeSpy).toHaveBeenCalledWith(drop.url);

    revokeSpy.mockRestore();
  });

  it('applySavedDocumentKeepingImages keeps blob refs after save (no dataUrl in editor)', async () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const reg = await registerImageBlob(file);
    const css = {
      '--width': '50mm',
      '--height': '40mm',
      '--translate-x': '0mm',
      '--translate-y': '0mm',
    };
    const editor = createEmptyDocument('Editor');
    editor.layers = [
      { id: 'img', type: 'image', name: 'Foto', value: reg.url, cssVars: css },
      { id: 'logo', type: 'logo', name: 'Logo', value: reg.blobId, cssVars: css },
      { id: 'rect', type: 'rect', name: 'R', value: '', cssVars: css },
    ];
    const saved = await serializeDocumentImages(editor);
    saved.updatedAt = '2026-08-03T12:00:00.000Z';
    saved.name = 'Renamed';

    const forEditor = applySavedDocumentKeepingImages(editor, saved);
    expect(forEditor.updatedAt).toBe('2026-08-03T12:00:00.000Z');
    expect(forEditor.name).toBe('Renamed');
    expect(forEditor.layers.find((l) => l.id === 'img')?.value).toBe(reg.url);
    expect(forEditor.layers.find((l) => l.id === 'logo')?.value).toBe(reg.blobId);
    // Persisted copy still has data URLs for IPC/cloud.
    expect(saved.layers.find((l) => l.id === 'img')?.value).toMatch(/^data:/);
    // Editor must not hold megabyte data: strings after save.
    const editorImg = forEditor.layers.find((l) => l.id === 'img')?.value ?? '';
    expect(editorImg.startsWith('data:')).toBe(false);
  });
});
