import { describe, expect, it, vi } from 'vitest';
import { reportFrontendError, reportFrontendEvent } from './observability';

describe('frontend observability', () => {
  it('sends a bounded, normalized report through preload', () => {
    const reportRendererError = vi.fn();
    window.electronAPI = { ...window.electronAPI!, reportRendererError };

    reportFrontendError({
      kind: 'react_error',
      view: 'canvas/editor',
      name: 'TypeError',
      message: 'boom\nnext line',
      stack: 'x'.repeat(5000),
      componentStack: ' at Canvas',
    });

    expect(reportRendererError).toHaveBeenCalledTimes(1);
    expect(reportRendererError.mock.calls[0][0]).toMatchObject({
      kind: 'react_error',
      view: 'canvas_editor',
      message: 'boom next line',
    });
    expect(reportRendererError.mock.calls[0][0].stack).toHaveLength(3000);
  });

  it('fails open when preload does not expose the reporting channel', () => {
    window.electronAPI = { ...window.electronAPI!, reportRendererError: undefined };
    expect(() => reportFrontendError({ kind: 'global_error', message: 'boom' })).not.toThrow();
  });

  it('reports toast_error and api_error with normalized fields', () => {
    const reportRendererError = vi.fn();
    window.electronAPI = { ...window.electronAPI!, reportRendererError };

    reportFrontendError({
      kind: 'toast_error',
      view: 'toast',
      name: 'ToastError',
      message: 'Operación fallida',
    });

    expect(reportRendererError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'toast_error',
        view: 'toast',
        name: 'ToastError',
        message: 'Operación fallida',
      }),
    );

    reportFrontendError({
      kind: 'api_error',
      view: 'api:canvas_save',
      name: 'AntaresAPIError[TIMEOUT]',
      message: 'IPC timeout: canvas_save',
    });

    expect(reportRendererError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'api_error',
        view: 'api:canvas_save',
        name: 'AntaresAPIError[TIMEOUT]',
        message: 'IPC timeout: canvas_save',
      }),
    );
  });

  it('reports bounded canvas realtime metrics without document content', async () => {
    const module = await import('./observability');
    const reportFrontendEvent = (module as typeof module & {
      reportFrontendEvent?: (report: unknown) => void;
    }).reportFrontendEvent;
    expect(reportFrontendEvent).toEqual(expect.any(Function));

    const reportRendererEvent = vi.fn();
    window.electronAPI = { ...window.electronAPI!, reportRendererEvent };
    reportFrontendEvent?.({
      event: 'canvas.realtime',
      status: 'live',
      count: 2,
      durationMs: 12.4,
      reason: 'reconnect',
    });

    expect(reportRendererEvent).toHaveBeenCalledWith('canvas.realtime', {
      view: 'canvas',
      status_class: 'live',
      count: 2,
      duration_ms: 12,
      reason: 'reconnect',
    }, 'INFO');
  });

  it('forwards request_id on error reports and new event names', () => {
    const reportRendererError = vi.fn();
    const reportRendererEvent = vi.fn();
    window.electronAPI = { ...window.electronAPI!, reportRendererError, reportRendererEvent };

    reportFrontendError({
      kind: 'api_error',
      view: 'api:canvas_save',
      name: 'AntaresAPIError[TIMEOUT]',
      message: 'IPC timeout: canvas_save',
      requestId: 'req-123-abc',
    });

    expect(reportRendererError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'api_error',
        request_id: 'req-123-abc',
      }),
    );

    reportFrontendEvent({
      event: 'canvas.push',
      level: 'WARN',
      outcome: 'degraded',
      reason: 'lww_rpc_v2_missing',
    });
    expect(reportRendererEvent).toHaveBeenCalledWith('canvas.push', {
      view: 'canvas',
      outcome: 'degraded',
      reason: 'lww_rpc_v2_missing',
    }, 'WARN');
  });
});
