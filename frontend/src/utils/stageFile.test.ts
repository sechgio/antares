import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { acquireStagedFile, stageFileForIpc } from './stageFile';

function installStagingBridge(overrides: Record<string, unknown> = {}) {
  const create = vi.fn(async () => ({ token: `staged_${create.mock.calls.length}` }));
  const append = vi.fn(async () => ({}));
  const complete = vi.fn(async (token: string) => ({ file_token: `read_${token}` }));
  const cleanup = vi.fn(async () => ({}));
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    fileStagedCreate: create,
    fileStagedAppend: append,
    fileStagedComplete: complete,
    cleanupFileToken: cleanup,
    ...overrides,
  };
  return { create, append, complete, cleanup };
}

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

  it('stages a fresh capability for each IPC operation', async () => {
    const create = vi.fn(async () => ({ token: `staged_reuse_${create.mock.calls.length}` }));
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      fileStagedCreate: create,
      fileStagedAppend: vi.fn(async () => ({})),
      fileStagedComplete: vi.fn(async (token: string) => ({ file_token: `read_${token}` })),
    };
    const file = new File([new Uint8Array([1, 2, 3])], 'reuse.xlsx');
    await expect(stageFileForIpc(file)).resolves.toBe('read_staged_reuse_1');
    await expect(stageFileForIpc(file)).resolves.toBe('read_staged_reuse_2');
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe('acquireStagedFile', () => {
  beforeEach(() => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stages once and shares the capability between concurrent handles', async () => {
    const bridge = installStagingBridge();
    const file = new File([new Uint8Array([1, 2, 3])], 'shared.pdf');

    const first = await acquireStagedFile(file);
    const second = await acquireStagedFile(file);

    expect(bridge.create).toHaveBeenCalledTimes(1);
    expect(first.token).toBe('read_staged_1');
    expect(second.token).toBe(first.token);

    first.release();
    expect(bridge.cleanup).not.toHaveBeenCalled();
    second.release();
  });

  it('keeps the staged copy alive between batches and disposes it once idle', async () => {
    vi.useFakeTimers();
    const bridge = installStagingBridge();
    const file = new File([new Uint8Array([1, 2, 3])], 'batch.pdf');

    const first = await acquireStagedFile(file);
    first.release();
    await vi.advanceTimersByTimeAsync(30_000);

    const second = await acquireStagedFile(file);
    expect(second.token).toBe(first.token);
    expect(bridge.create).toHaveBeenCalledTimes(1);
    second.release();

    expect(bridge.cleanup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(bridge.cleanup).toHaveBeenCalledExactlyOnceWith('read_staged_1');
  });

  it('stages a fresh copy once the shared entry has been disposed', async () => {
    vi.useFakeTimers();
    const bridge = installStagingBridge();
    const file = new File([new Uint8Array([1, 2, 3])], 'fresh.pdf');

    const first = await acquireStagedFile(file);
    first.release();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 1);

    const second = await acquireStagedFile(file);
    expect(bridge.create).toHaveBeenCalledTimes(2);
    expect(second.token).not.toBe(first.token);
    second.release();
  });

  it('never hands out a capability older than the reuse window', async () => {
    vi.useFakeTimers();
    const bridge = installStagingBridge();
    const file = new File([new Uint8Array([1, 2, 3])], 'aged.pdf');

    const tokens: Array<string | null> = [];
    for (let step = 0; step < 15; step += 1) {
      const handle = await acquireStagedFile(file);
      tokens.push(handle.token);
      handle.release();
      await vi.advanceTimersByTimeAsync(90_000);
    }

    expect(bridge.create).toHaveBeenCalledTimes(2);
    expect(tokens[0]).toBe('read_staged_1');
    expect(tokens[tokens.length - 1]).toBe('read_staged_2');
  });

  it('stages a fresh copy when the shared entry aged out while still referenced', async () => {
    vi.useFakeTimers();
    const bridge = installStagingBridge();
    const file = new File([new Uint8Array([1, 2, 3])], 'kept.pdf');

    const first = await acquireStagedFile(file);
    await vi.advanceTimersByTimeAsync(21 * 60 * 1000);

    const second = await acquireStagedFile(file);
    expect(bridge.create).toHaveBeenCalledTimes(2);
    expect(second.token).toBe('read_staged_2');
    expect(second.token).not.toBe(first.token);

    first.release();
    const third = await acquireStagedFile(file);
    expect(third.token).toBe(second.token);
    expect(bridge.create).toHaveBeenCalledTimes(2);
    second.release();
    third.release();
  });

  it('rolls back the shared entry when staging fails', async () => {
    const create = vi.fn(async () => ({ token: 'staged_boom' }));
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      fileStagedCreate: create,
      fileStagedAppend: vi.fn(async () => {
        throw new Error('append failed');
      }),
      fileStagedComplete: vi.fn(async () => ({ file_token: 'read_boom' })),
      fileStagedAbort: vi.fn(async () => ({})),
      cleanupFileToken: vi.fn(async () => ({})),
    };
    const file = new File([new Uint8Array([1, 2, 3])], 'boom.pdf');

    await expect(acquireStagedFile(file)).rejects.toThrow('append failed');
    await expect(acquireStagedFile(file)).rejects.toThrow('append failed');
    expect(create).toHaveBeenCalledTimes(2);
  });
});
