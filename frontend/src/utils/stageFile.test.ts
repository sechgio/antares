import { describe, expect, it, vi, beforeEach } from 'vitest';
import { stageFileForIpc } from './stageFile';

describe('stageFileForIpc', () => {
  beforeEach(() => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = undefined;
  });

  it('returns null when Electron staging APIs are missing', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'a.xlsx');
    await expect(stageFileForIpc(file)).resolves.toBeNull();
  });

  it('appends ArrayBuffer slices (not base64 strings)', async () => {
    const append = vi.fn(async () => ({}));
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      fileStagedCreate: vi.fn(async () => ({ token: 'staged_1' })),
      fileStagedAppend: append,
      fileStagedComplete: vi.fn(async () => ({ file_token: 'read_1' })),
    };

    const bytes = new Uint8Array(7 * 1024 * 1024).map((_, i) => i % 256);
    const file = new File([bytes], 'big.xlsx');
    await expect(stageFileForIpc(file)).resolves.toBe('read_1');

    expect(append).toHaveBeenCalledTimes(2);
    for (const call of append.mock.calls) {
      expect(typeof call[1]).not.toBe('string');
      expect(call[1]).toBeInstanceOf(ArrayBuffer);
    }
    const total = append.mock.calls.reduce(
      (n: number, c: unknown[]) => n + (c[1] as ArrayBuffer).byteLength,
      0,
    );
    expect(total).toBe(bytes.byteLength);
  });

  it('aborts the staged session when uploading or completing fails', async () => {
    const abort = vi.fn(async () => ({}));
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      fileStagedCreate: vi.fn(async () => ({ token: 'staged_failed' })),
      fileStagedAppend: vi.fn(async () => {
        throw new Error('append failed');
      }),
      fileStagedComplete: vi.fn(async () => ({ file_token: 'read_failed' })),
      fileStagedAbort: abort,
    };

    const file = new File([new Uint8Array([1, 2, 3])], 'failed.xlsx');
    await expect(stageFileForIpc(file)).rejects.toThrow('append failed');
    expect(abort).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledWith('staged_failed');
  });
});
