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
        health: {
          last_probe_at: '2026-08-26T00:00:00.000Z',
          last_success_at: '2026-08-26T00:00:00.000Z',
          last_probe_ms: 3,
          last_probe_outcome: 'success',
          consecutive_failures: 0,
          skipped_total: 0,
          last_skip_reason: null,
          last_failure_at: null,
          last_failure_reason: null,
          probes_total: 1,
          successes_total: 1,
          failures_total: 0,
          restarts_total: 0,
        },
      }),
      backendRestart: vi.fn().mockResolvedValue({ success: true, state: 'ready' }),
      onNotify: vi.fn((callback) => {
        notify = callback;
        return () => {};
      }),
    };
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const { result } = renderHook(() => useBackendStatus());
    await act(async () => Promise.resolve());

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(result.current.health?.last_probe_ms).toBe(3);

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
