import { afterEach, describe, expect, it, vi } from 'vitest';

const workerLifecycle = vi.hoisted(() => ({
  dispose: vi.fn(),
  process: vi.fn(async (file: File) => ({ blob: file, width: 1, height: 1 })),
}));

vi.mock('../workers/imageProcessorClient', () => ({
  disposeImageProcessorWorker: workerLifecycle.dispose,
  processImageFileForCanvas: workerLifecycle.process,
}));

import { clearBlobStore, registerImageBlob } from '../utils/imageBlobStore';

describe('image blob store worker lifecycle', () => {
  afterEach(() => {
    clearBlobStore();
    vi.clearAllMocks();
  });

  it('disposes the lazily loaded image worker when the store is cleared', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
    await registerImageBlob(file);
    expect(workerLifecycle.process).toHaveBeenCalledOnce();

    clearBlobStore();

    await vi.waitFor(() => expect(workerLifecycle.dispose).toHaveBeenCalledOnce());
  });
});
