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
