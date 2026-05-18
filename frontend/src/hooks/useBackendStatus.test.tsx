import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBackendStatus } from './useBackendStatus';

describe('useBackendStatus polling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps a single polling interval while lifecycle notifications change state', async () => {
    let notify: ((method: string, params: unknown) => void) | null = null;
    window.electronAPI = {
      ...window.electronAPI!,
      backendStatus: vi.fn().mockResolvedValue({
        state: 'starting',
        ready: false,
        lastError: null,
        stderrTail: '',
      }),
      backendRestart: vi.fn().mockResolvedValue({ success: true, state: 'ready' }),
      onNotify: vi.fn((callback) => {
        notify = callback;
        return () => {};
      }),
    };
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    renderHook(() => useBackendStatus());
    await act(async () => Promise.resolve());

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    act(() => {
      notify?.('backend.ready', {});
      notify?.('backend.restarting', {});
    });

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('surfaces fatal backend state when automatic retries are exhausted', async () => {
    window.electronAPI = {
      ...window.electronAPI!,
      backendStatus: vi.fn().mockResolvedValue({
        state: 'fatal',
        ready: false,
        lastError: { kind: 'fatal', message: 'reinicio manual requerido', stderrTail: '' },
        stderrTail: '',
      }),
      backendRestart: vi.fn().mockResolvedValue({ success: false, state: 'fatal' }),
      onNotify: vi.fn(() => () => {}),
    };

    const { result } = renderHook(() => useBackendStatus());
    await act(async () => Promise.resolve());

    expect(result.current.backendState).toBe('fatal');
    expect(result.current.errorMessage).toBe('reinicio manual requerido');
  });
});
