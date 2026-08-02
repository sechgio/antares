import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearBlobStore,
  getBlobUrl,
  getThumbnailUrl,
  hydrateDocumentImages,
  registerImageBlob,
  releaseImageBlob,
  serializeDocumentImages,
} from '../utils/imageBlobStore';
import { createEmptyDocument } from '../types';

describe('imageBlobStore', () => {
  afterEach(() => {
    clearBlobStore();
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

  it('serializes ObjectURL layers back to persistent DataURLs for saving', async () => {
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
});
