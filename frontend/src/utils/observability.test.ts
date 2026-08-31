import { describe, expect, it, vi } from 'vitest';
import { reportFrontendError } from './observability';

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
});
