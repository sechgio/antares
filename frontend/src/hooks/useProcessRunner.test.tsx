import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockApi = vi.hoisted(() => ({
  startProcess: vi.fn(),
  getStatus: vi.fn(),
  cancelProcess: vi.fn(),
}));

let notifyCallback: ((method: string, params: unknown) => void) | null = null;

vi.mock('../api', () => ({
  api: mockApi,
  onNotify: (callback: (method: string, params: unknown) => void) => {
    notifyCallback = callback;
    return () => {
      notifyCallback = null;
    };
  },
}));

import { useProcessRunner } from './useProcessRunner';

const emptyProcessBody = {
  files: ['C:\\a.jpg'],
  destino: 'C:\\out',
  formato: 'JPEG',
  calidad: 85,
  resize_ancho: null,
  resize_alto: null,
  keep_exif: true,
  usar_rename: false,
  patron: '',
  secuencia: 1,
  use_filename_seq: false,
};

describe('useProcessRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifyCallback = null;
    mockApi.getStatus.mockResolvedValue({
      running: false,
      progress: 0,
      current_file: '',
      ok_count: 0,
      err_count: 0,
      logs: [],
    });
    mockApi.startProcess.mockResolvedValue({ started: true });
    mockApi.cancelProcess.mockResolvedValue({ cancelled: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('merges process.progress when status was previously null', async () => {
    const { result } = renderHook(() => useProcessRunner());
    await act(async () => Promise.resolve());

    expect(result.current.status).toBeNull();
    expect(result.current.running).toBe(false);

    act(() => {
      notifyCallback?.('process.progress', {
        progress: 42,
        current_file: 'photo.jpg',
        ok_count: 3,
        err_count: 1,
      });
    });

    expect(result.current.status).not.toBeNull();
    expect(result.current.status?.progress).toBe(42);
    expect(result.current.status?.current_file).toBe('photo.jpg');
    expect(result.current.status?.ok_count).toBe(3);
    expect(result.current.status?.err_count).toBe(1);
    expect(result.current.status?.running).toBe(true);
    expect(result.current.running).toBe(true);
  });

  it('clears running on soft start failure { started: false }', async () => {
    mockApi.startProcess.mockResolvedValue({ started: false, reason: 'already_running' });

    const { result } = renderHook(() => useProcessRunner());
    await act(async () => Promise.resolve());

    let returned: { started: boolean; reason?: string } | undefined;
    await act(async () => {
      returned = await result.current.startProcess(emptyProcessBody);
    });

    expect(returned).toEqual({ started: false, reason: 'already_running' });
    expect(result.current.running).toBe(false);
    expect(result.current.status?.running).toBe(false);
  });

  it('clears running and rethrows on hard start failure', async () => {
    mockApi.startProcess.mockRejectedValue(new Error('IPC timeout'));

    const { result } = renderHook(() => useProcessRunner());
    await act(async () => Promise.resolve());

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.startProcess(emptyProcessBody);
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('IPC timeout');
    expect(result.current.running).toBe(false);
  });

  it('resets running on backend.restarting / backend.fatal / backend.error', async () => {
    const { result } = renderHook(() => useProcessRunner());
    await act(async () => Promise.resolve());

    // Seed a running state via progress notify
    act(() => {
      notifyCallback?.('process.progress', { progress: 10, current_file: 'a.jpg', ok_count: 0, err_count: 0 });
    });
    expect(result.current.running).toBe(true);

    act(() => {
      notifyCallback?.('backend.restarting', {});
    });
    expect(result.current.running).toBe(false);
    expect(result.current.status?.running).toBe(false);

    // Re-seed running
    act(() => {
      notifyCallback?.('process.progress', { progress: 20, current_file: 'b.jpg' });
    });
    expect(result.current.running).toBe(true);

    act(() => {
      notifyCallback?.('backend.fatal', {});
    });
    expect(result.current.running).toBe(false);

    act(() => {
      notifyCallback?.('process.progress', { progress: 30, current_file: 'c.jpg' });
    });
    expect(result.current.running).toBe(true);

    act(() => {
      notifyCallback?.('backend.error', { message: 'boom' });
    });
    expect(result.current.running).toBe(false);
  });

  it('does not clear running on backend.ready or backend.starting', async () => {
    const { result } = renderHook(() => useProcessRunner());
    await act(async () => Promise.resolve());

    act(() => {
      notifyCallback?.('process.progress', { progress: 15, current_file: 'x.jpg' });
    });
    expect(result.current.running).toBe(true);

    act(() => {
      notifyCallback?.('backend.starting', {});
      notifyCallback?.('backend.ready', {});
    });
    expect(result.current.running).toBe(true);
  });

  it('applies process.complete without prior status seed', async () => {
    const { result } = renderHook(() => useProcessRunner());
    await act(async () => Promise.resolve());

    expect(result.current.status).toBeNull();

    act(() => {
      notifyCallback?.('process.complete', {
        progress: 100,
        ok_count: 5,
        err_count: 0,
        current_file: 'last.jpg',
      });
    });

    expect(result.current.running).toBe(false);
    expect(result.current.status).not.toBeNull();
    expect(result.current.status?.running).toBe(false);
    expect(result.current.status?.progress).toBe(100);
    expect(result.current.status?.ok_count).toBe(5);
    expect(result.current.status?.err_count).toBe(0);
    expect(result.current.status?.current_file).toBe('last.jpg');
  });

  it('sets running=true optimistically before startProcess resolves', async () => {
    let resolveStart!: (value: { started: boolean }) => void;
    mockApi.startProcess.mockImplementation(
      () =>
        new Promise<{ started: boolean }>((resolve) => {
          resolveStart = resolve;
        }),
    );
    mockApi.getStatus.mockResolvedValue({
      running: true,
      progress: 0,
      current_file: '',
      ok_count: 0,
      err_count: 0,
      logs: [],
    });

    const { result } = renderHook(() => useProcessRunner());
    await act(async () => Promise.resolve());

    let startPromise: Promise<unknown>;
    act(() => {
      startPromise = result.current.startProcess(emptyProcessBody);
    });

    // Before the IPC call resolves, running must already be true
    expect(result.current.running).toBe(true);

    await act(async () => {
      resolveStart({ started: true });
      await startPromise!;
    });

    expect(result.current.running).toBe(true);
  });
});
