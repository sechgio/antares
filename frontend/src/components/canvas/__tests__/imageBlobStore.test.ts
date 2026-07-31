import { afterEach, describe, expect, it } from 'vitest';
import {
  clearBlobStore,
  getBlobUrl,
  getThumbnailUrl,
  hydrateDocumentImages,
  registerImageBlob,
  serializeDocumentImages,
} from '../utils/imageBlobStore';
import { createEmptyDocument } from '../types';

describe('imageBlobStore', () => {
  afterEach(() => {
    clearBlobStore();
  });

  it('registers a Blob and generates ObjectURL and thumbnail', async () => {
    const fakeBlob = new Blob(['fake image content'], { type: 'image/png' });
    const registered = await registerImageBlob(fakeBlob);

    expect(registered.blobId).toMatch(/^img_blob_/);
    expect(registered.url).toMatch(/^blob:/);
    expect(getBlobUrl(registered.blobId)).toBe(registered.url);
    expect(getThumbnailUrl(registered.blobId)).toBeDefined();
  });

  it('hydrates base64 image layers into light ObjectURLs', async () => {
    const doc = createEmptyDocument('Test Doc');
    const base64Data =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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
    expect(imgLayer?.value).toMatch(/^blob:/);
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
      expect(layer.value).toMatch(/^blob:/);
    }
  });
});
