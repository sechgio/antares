import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalThumbnail, _resetLocalThumbForTests } from './localThumb';

const localThumbnail = vi.fn();

vi.mock('../api', () => ({
  api: {
    localThumbnail: (...args: unknown[]) => localThumbnail(...args),
  },
}));

describe('getLocalThumbnail', () => {
  beforeEach(() => {
    _resetLocalThumbForTests();
    localThumbnail.mockReset();
  });

  it('returns data URL on success and caches it', async () => {
    localThumbnail.mockResolvedValueOnce({ dataUrl: 'data:image/jpeg;base64,abc' });

    const first = await getLocalThumbnail('C:\\photos\\a.jpg', 256);
    const second = await getLocalThumbnail('C:\\photos\\a.jpg', 256);

    expect(first).toBe('data:image/jpeg;base64,abc');
    expect(second).toBe('data:image/jpeg;base64,abc');
    expect(localThumbnail).toHaveBeenCalledTimes(1);
    expect(localThumbnail).toHaveBeenCalledWith({ path: 'C:\\photos\\a.jpg', maxEdge: 256 });
  });

  it('coalesces concurrent requests for the same path into one IPC call', async () => {
    let resolveIpc!: (value: { dataUrl: string }) => void;
    localThumbnail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveIpc = resolve;
        }),
    );

    const p1 = getLocalThumbnail('C:\\photos\\same.jpg', 256);
    const p2 = getLocalThumbnail('C:\\photos\\same.jpg', 256);

    expect(localThumbnail).toHaveBeenCalledTimes(1);
    resolveIpc({ dataUrl: 'data:image/jpeg;base64,coalesced' });

    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe('data:image/jpeg;base64,coalesced');
    expect(b).toBe('data:image/jpeg;base64,coalesced');
    expect(localThumbnail).toHaveBeenCalledTimes(1);
  });

  it('clears in-flight on IPC failure so a later call can retry', async () => {
    localThumbnail.mockRejectedValueOnce(new Error('nativeImage not available'));

    const [a, b] = await Promise.all([
      getLocalThumbnail('C:\\photos\\fail.jpg', 256),
      getLocalThumbnail('C:\\photos\\fail.jpg', 256),
    ]);
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(localThumbnail).toHaveBeenCalledTimes(1);

    localThumbnail.mockResolvedValueOnce({ dataUrl: 'data:image/jpeg;base64,retry' });
    const retry = await getLocalThumbnail('C:\\photos\\fail.jpg', 256);
    expect(retry).toBe('data:image/jpeg;base64,retry');
    expect(localThumbnail).toHaveBeenCalledTimes(2);
  });

  it('returns null on IPC failure so caller can fall back to file://', async () => {
    localThumbnail.mockRejectedValueOnce(new Error('nativeImage not available'));

    const result = await getLocalThumbnail('C:\\photos\\missing.jpg');
    expect(result).toBeNull();
  });

  it('returns null for empty path without calling API', async () => {
    const result = await getLocalThumbnail('   ');
    expect(result).toBeNull();
    expect(localThumbnail).not.toHaveBeenCalled();
  });

  it('returns null when response lacks a data URL', async () => {
    localThumbnail.mockResolvedValueOnce({ dataUrl: 'not-a-data-url' });
    expect(await getLocalThumbnail('C:\\photos\\b.jpg')).toBeNull();
  });
});
